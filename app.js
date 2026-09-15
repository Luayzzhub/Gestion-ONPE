/**
 * SISTEMA DE GESTIÓN DE MIEMBROS DE MESA - ONPE 2026 (LIMA OESTE 1)
 * Arquitectura Centralizada Cloud-Ready con API REST y Base de Datos Relacional ACID.
 * Multitenencia con Aislamiento Estricto por Coordinador de Mesa.
 */

// ==========================================
// 1. CLIENTE DE API REST Y UTILIDADES
// ==========================================

/**
 * Realiza peticiones HTTP a la API REST centralizada.
 * Maneja encabezados de autorización Bearer de forma automática.
 */
async function apiFetch(endpoint, options = {}) {
    const token = localStorage.getItem("onpe_token") || sessionStorage.getItem("onpe_token");
    const headers = {
        'Accept': 'application/json',
        ...(options.headers || {})
    };

    if (options.body && typeof options.body === 'string') {
        headers['Content-Type'] = 'application/json';
    }

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    try {
        const res = await fetch(endpoint, { ...options, headers });
        const data = await res.json().catch(() => ({}));

        if (res.status === 401 && !endpoint.includes('/api/auth/login')) {
            cerrarSesion(false);
            return { ok: false, status: 401, error: "Sesión expirada" };
        }

        return { ok: res.ok, status: res.status, data };
    } catch (err) {
        console.error(`Error en llamada API [${endpoint}]:`, err);
        return {
            ok: false,
            status: 0,
            error: "No se pudo conectar con el servidor. Verifica tu conexión a internet o datos móviles."
        };
    }
}

// ==========================================
// 2. ESTADO GLOBAL DE LA APLICACIÓN (MEMORIA)
// ==========================================
let sesionActiva = {
    autenticado: false,
    usuarioId: null,
    nombre: '',
    usuario: '',
    datos: {
        mesas: [],
        miembros: []
    }
};

// Stream de cámara en vivo para escaneo OCR
let streamCamaraActivo = null;

// ==========================================
// 3. GESTIÓN DE SESIÓN Y AUTENTICACIÓN
// ==========================================

// Alternar entre panel de Login y panel de Registro
function mostrarPanelAuth(panel) {
    const pLogin = document.getElementById("panel-login");
    const pRegistro = document.getElementById("panel-registro");
    const alertCont = document.getElementById("auth-alert-container");

    if (alertCont) alertCont.innerHTML = "";

    if (panel === "registro") {
        pLogin?.classList.add("d-none");
        pRegistro?.classList.remove("d-none");
        document.getElementById("form-registro")?.reset();
    } else {
        pRegistro?.classList.add("d-none");
        pLogin?.classList.remove("d-none");
        document.getElementById("form-login")?.reset();
    }
}

// Mostrar alertas en la pantalla de Login / Registro
function mostrarAuthAlert(mensaje, tipo = "danger") {
    const contenedor = document.getElementById("auth-alert-container");
    if (!contenedor) return;
    contenedor.innerHTML = `
        <div class="alert alert-${tipo} alert-dismissible fade show rounded-3 small py-2 mb-3" role="alert">
            ${mensaje}
            <button type="button" class="btn-close py-2" data-bs-dismiss="alert" aria-label="Cerrar"></button>
        </div>`;
}

// Iniciar sesión del coordinador contra el servidor central
async function iniciarSesion(usuario, password) {
    const resp = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ usuario, password })
    });

    if (!resp.ok) {
        mostrarAuthAlert(resp.data?.error || resp.error || "Credenciales incorrectas.");
        return false;
    }

    const { token, usuario: user } = resp.data;
    localStorage.setItem("onpe_token", token);
    sessionStorage.setItem("onpe_token", token);

    sesionActiva = {
        autenticado: true,
        usuarioId: user.id,
        nombre: user.nombre,
        usuario: user.usuario,
        datos: { mesas: [], miembros: [] }
    };

    await cargarDatosDesdeServidor();
    actualizarUIAutenticacion(true);
    sincronizarTodoUI();
    navegarA('dashboard');
    return true;
}

// Registrar nuevo coordinador en la base de datos central
async function registrarCoordinador(nombre, usuario, password) {
    const resp = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ nombre, usuario, password })
    });

    if (!resp.ok) {
        mostrarAuthAlert(resp.data?.error || resp.error || "Ocurrió un error al crear la cuenta.");
        return false;
    }

    const { token, usuario: user } = resp.data;
    localStorage.setItem("onpe_token", token);
    sessionStorage.setItem("onpe_token", token);

    sesionActiva = {
        autenticado: true,
        usuarioId: user.id,
        nombre: user.nombre,
        usuario: user.usuario,
        datos: { mesas: [], miembros: [] }
    };

    actualizarUIAutenticacion(true);
    sincronizarTodoUI();
    navegarA('dashboard');
    return true;
}

// Cargar mesas y miembros del servidor asignados a este coordinador
async function cargarDatosDesdeServidor() {
    const [mesasRes, miembrosRes] = await Promise.all([
        apiFetch('/api/mesas'),
        apiFetch('/api/miembros')
    ]);

    if (mesasRes.ok && mesasRes.data?.mesas) {
        sesionActiva.datos.mesas = mesasRes.data.mesas;
    } else {
        sesionActiva.datos.mesas = [];
    }

    if (miembrosRes.ok && miembrosRes.data?.miembros) {
        sesionActiva.datos.miembros = miembrosRes.data.miembros;
    } else {
        sesionActiva.datos.miembros = [];
    }
}

// Restaurar sesión activa si existe token (soporta F5, pestaña cerrada o navegación móvil)
async function restaurarSesionActiva() {
    const token = localStorage.getItem("onpe_token") || sessionStorage.getItem("onpe_token");
    if (!token) {
        cerrarSesion(false);
        return;
    }

    const resp = await apiFetch('/api/auth/me');
    if (resp.ok && resp.data?.usuario) {
        const user = resp.data.usuario;
        sesionActiva = {
            autenticado: true,
            usuarioId: user.id,
            nombre: user.nombre,
            usuario: user.usuario,
            datos: { mesas: [], miembros: [] }
        };

        await cargarDatosDesdeServidor();
        actualizarUIAutenticacion(true);
        sincronizarTodoUI();
        navegarA('dashboard');
    } else {
        cerrarSesion(false);
    }
}

// Cerrar sesión
async function cerrarSesion(notificarServidor = true) {
    if (notificarServidor) {
        await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    }

    localStorage.removeItem("onpe_token");
    sessionStorage.removeItem("onpe_token");

    sesionActiva = {
        autenticado: false,
        usuarioId: null,
        nombre: '',
        usuario: '',
        datos: { mesas: [], miembros: [] }
    };

    // Limpiar DOM de datos de usuario
    const contMesas = document.getElementById("contenedor-mesas");
    if (contMesas) contMesas.innerHTML = "";
    const contMiembros = document.getElementById("contenedor-miembros");
    if (contMiembros) contMiembros.innerHTML = "";
    const contMapa = document.getElementById("contenedor-lista-mapa");
    if (contMapa) contMapa.innerHTML = "";

    mostrarPanelAuth('login');
    actualizarUIAutenticacion(false);
    navegarA('auth');
}

// Actualizar barra de navegación según autenticación
function actualizarUIAutenticacion(autenticado) {
    const navSecciones = document.getElementById("nav-secciones-autenticado");
    const navAcciones = document.getElementById("nav-acciones-autenticado");
    const txtNombre = document.getElementById("txt-nombre-coordinador");

    if (autenticado) {
        navSecciones?.classList.remove("d-none");
        navAcciones?.classList.remove("d-none");
        navAcciones?.classList.add("d-flex");
        if (txtNombre) txtNombre.textContent = sesionActiva.nombre || sesionActiva.usuario;
    } else {
        navSecciones?.classList.add("d-none");
        navAcciones?.classList.add("d-none");
        navAcciones?.classList.remove("d-flex");
    }
}

// ==========================================
// 4. NAVEGACIÓN Y CONTROLADOR SPA
// ==========================================
function navegarA(vistaId, filtroMesa = null) {
    if (!sesionActiva.autenticado && vistaId !== 'auth') {
        vistaId = 'auth';
    }

    // Ocultar todas las secciones
    document.querySelectorAll('.vista-seccion').forEach(seccion => {
        seccion.classList.add('d-none');
    });

    // Desmarcar navbar
    document.querySelectorAll('.navbar-nav .nav-link').forEach(link => {
        link.classList.remove('active');
    });

    // Mostrar sección de destino
    const seccionDestino = document.getElementById(`vista-${vistaId}`);
    if (seccionDestino) {
        seccionDestino.classList.remove('d-none');
    }

    // Marcar link activo
    const linkDestino = document.getElementById(`nav-${vistaId}`);
    if (linkDestino) {
        linkDestino.classList.add('active');
    }

    // Actualizar vista requerida al navegar
    if (vistaId === 'dashboard') {
        actualizarSelectoresMesas();
        renderizarDashboard();
    } else if (vistaId === 'mesas') {
        renderizarMesas();
    } else if (vistaId === 'miembros') {
        actualizarSelectoresMesas();
        if (filtroMesa) {
            const selectMesa = document.getElementById('filtro-mesa');
            if (selectMesa) selectMesa.value = filtroMesa;
        }
        aplicarFiltros();
    } else if (vistaId === 'mapa') {
        renderizarMapaVisitas();
    }

    // Cerrar navbar en móviles al seleccionar vista
    const navbarCollapse = document.getElementById('navbarContenido');
    if (navbarCollapse && navbarCollapse.classList.contains('show')) {
        const bsCollapse = bootstrap.Collapse.getOrCreateInstance(navbarCollapse);
        if (bsCollapse) bsCollapse.hide();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Sincronizar selectores de mesas en filtros y modales
function actualizarSelectoresMesas() {
    const mesas = sesionActiva.datos.mesas || [];

    const selectores = [
        document.getElementById("dashboard-filtro-mesa"),
        document.getElementById("filtro-mesa"),
        document.getElementById("mapa-filtro-mesa"),
        document.getElementById("nuevo-miembro-mesa"),
        document.getElementById("gestion-mesa-select"),
        document.getElementById("ocr-mesa")
    ];

    selectores.forEach(select => {
        if (!select) return;
        const valorPrevio = select.value;
        const esFiltro = select.id.includes("filtro");

        select.innerHTML = esFiltro ? '<option value="">Todas las mesas</option>' : '';

        if (mesas.length === 0 && !esFiltro) {
            select.innerHTML = '<option value="" disabled selected>No hay mesas registradas</option>';
            return;
        }

        mesas.forEach(m => {
            const opt = document.createElement("option");
            opt.value = m.numero;
            opt.textContent = `Mesa ${m.numero} ${m.localVotacion ? `(${m.localVotacion})` : ''}`;
            select.appendChild(opt);
        });

        if (valorPrevio && mesas.some(m => m.numero === valorPrevio)) {
            select.value = valorPrevio;
        }
    });
}

// Sincronizar toda la interfaz de usuario
function sincronizarTodoUI() {
    actualizarSelectoresMesas();
    renderizarDashboard();
    renderizarMesas();
    aplicarFiltros();
    renderizarMapaVisitas();
}

// ==========================================
// 5. DASHBOARD INTERACTIVO
// ==========================================
function renderizarDashboard() {
    if (!sesionActiva.autenticado) return;

    const todos = sesionActiva.datos.miembros || [];
    const filtroMesa = document.getElementById("dashboard-filtro-mesa")?.value || "";
    const datosFiltrados = filtroMesa ? todos.filter(m => m.mesa === filtroMesa) : todos;

    const total = datosFiltrados.length;
    const contactados = datosFiltrados.filter(m => m.contactado).length;
    const credenciales = datosFiltrados.filter(m => m.credencial).length;
    const capacitados = datosFiltrados.filter(m => m.capacitacion).length;
    const visitados = datosFiltrados.filter(m => m.visitaRealizada || m.visitaEstado === 'visitado').length;

    // Tarjetas de KPIs
    const elTotal = document.getElementById("stat-total");
    if (elTotal) elTotal.textContent = total;
    const elCont = document.getElementById("stat-contactados");
    if (elCont) elCont.textContent = contactados;
    const elCred = document.getElementById("stat-credenciales");
    if (elCred) elCred.textContent = credenciales;
    const elCap = document.getElementById("stat-capacitados");
    if (elCap) elCap.textContent = capacitados;

    // Resumen de pendientes
    const pendContacto = total - contactados;
    const pendCredencial = total - credenciales;
    const pendCapacitacion = total - capacitados;
    const pendVisita = total - visitados;

    const elPendC = document.getElementById("stat-pendiente-contacto");
    if (elPendC) elPendC.textContent = pendContacto;
    const elPendCred = document.getElementById("stat-pendiente-credencial");
    if (elPendCred) elPendCred.textContent = pendCredencial;
    const elPendCap = document.getElementById("stat-pendiente-capacitacion");
    if (elPendCap) elPendCap.textContent = pendCapacitacion;
    const elPendVis = document.getElementById("stat-pendiente-visita");
    if (elPendVis) elPendVis.textContent = pendVisita;

    // Progreso general (contacto + credencial + capacitación)
    const tareasPosibles = total * 3;
    const tareasRealizadas = contactados + credenciales + capacitados;
    const porcentaje = tareasPosibles > 0 ? Math.round((tareasRealizadas / tareasPosibles) * 100) : 0;

    const barraProgreso = document.getElementById("stat-barra-progreso");
    const textoProgreso = document.getElementById("stat-porcentaje-progreso");
    if (barraProgreso) {
        barraProgreso.style.width = `${porcentaje}%`;
        barraProgreso.setAttribute("aria-valuenow", porcentaje);
    }
    if (textoProgreso) {
        textoProgreso.textContent = `${porcentaje}%`;
    }
}

// Navegar desde tarjeta del Dashboard a Miembros con filtro aplicado
function irAMiembrosConFiltro(estado, cargo = '') {
    const filtroMesaDashboard = document.getElementById("dashboard-filtro-mesa")?.value || "";
    const selectMesa = document.getElementById("filtro-mesa");
    const selectEstado = document.getElementById("filtro-estado");
    const selectCargo = document.getElementById("filtro-cargo");
    const inputBusqueda = document.getElementById("input-busqueda");

    if (selectMesa) selectMesa.value = filtroMesaDashboard;
    if (selectEstado) selectEstado.value = estado;
    if (selectCargo) selectCargo.value = cargo;
    if (inputBusqueda) inputBusqueda.value = "";

    navegarA('miembros');
}

// ==========================================
// 6. GESTIÓN DINÁMICA DE MESAS
// ==========================================
function renderizarMesas() {
    if (!sesionActiva.autenticado) return;

    const contenedor = document.getElementById("contenedor-mesas");
    if (!contenedor) return;
    contenedor.innerHTML = "";

    const mesas = sesionActiva.datos.mesas || [];
    const todosMiembros = sesionActiva.datos.miembros || [];

    const txtTotalSub = document.getElementById("txt-total-mesas-sub");
    if (txtTotalSub) {
        txtTotalSub.textContent = `Supervisión de ${mesas.length} mesa(s) electoral(es) asignada(s)`;
    }

    if (mesas.length === 0) {
        contenedor.innerHTML = `
            <div class="col-12 text-center py-5">
                <div class="p-4 bg-white rounded-4 shadow-sm border">
                    <h5 class="fw-bold mb-2">No tienes mesas electorales registradas aún</h5>
                    <p class="text-muted mb-3 small">Registra los números de mesa asignados a tu coordinación.</p>
                    <button class="btn btn-primary rounded-pill px-4 shadow-sm" onclick="abrirModalNuevaMesa()">
                        ➕ Registrar Mesa
                    </button>
                </div>
            </div>`;
        return;
    }

    mesas.forEach(mesaObj => {
        const miembrosMesa = todosMiembros.filter(m => m.mesa === mesaObj.numero);
        const total = miembrosMesa.length;
        const contactados = miembrosMesa.filter(m => m.contactado).length;
        const credenciales = miembrosMesa.filter(m => m.credencial).length;
        const capacitados = miembrosMesa.filter(m => m.capacitacion).length;

        const tareasPosibles = total * 3;
        const tareasRealizadas = contactados + credenciales + capacitados;
        const porcentajeMesa = tareasPosibles > 0 ? Math.round((tareasRealizadas / tareasPosibles) * 100) : 0;

        const cardHTML = `
            <div class="col-12 col-md-6 col-lg-4">
                <div class="card shadow-sm h-100 border-0 rounded-4">
                    <div class="card-body d-flex flex-column p-4">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <h5 class="card-title fw-bold mb-0">Mesa ${mesaObj.numero}</h5>
                            <span class="badge bg-primary-subtle text-primary-emphasis rounded-pill px-3 py-2">${total} Miembros</span>
                        </div>

                        ${mesaObj.localVotacion ? `<small class="text-muted mb-2 d-block">📍 ${mesaObj.localVotacion} ${mesaObj.distrito ? `(${mesaObj.distrito})` : ''}</small>` : ''}

                        <div class="mb-3 mt-1">
                            <div class="d-flex justify-content-between small text-muted mb-1">
                                <span>Avance de la mesa</span>
                                <strong class="text-primary">${porcentajeMesa}%</strong>
                            </div>
                            <div class="progress" style="height: 8px;">
                                <div class="progress-bar bg-primary" style="width: ${porcentajeMesa}%;"></div>
                            </div>
                        </div>

                        <ul class="list-unstyled mb-4 small">
                            <li class="d-flex justify-content-between py-2 border-bottom">
                                <span>Contactados:</span>
                                <span class="badge ${contactados > 0 && contactados === total ? 'bg-success' : 'bg-secondary'} rounded-pill">${contactados}/${total}</span>
                            </li>
                            <li class="d-flex justify-content-between py-2 border-bottom">
                                <span>Credenciales:</span>
                                <span class="badge ${credenciales > 0 && credenciales === total ? 'bg-success' : 'bg-secondary'} rounded-pill">${credenciales}/${total}</span>
                            </li>
                            <li class="d-flex justify-content-between py-2 border-bottom">
                                <span>Capacitados:</span>
                                <span class="badge ${capacitados > 0 && capacitados === total ? 'bg-success' : 'bg-secondary'} rounded-pill">${capacitados}/${total}</span>
                            </li>
                        </ul>

                        <div class="mt-auto d-flex gap-2">
                            <button class="btn btn-outline-primary btn-sm flex-grow-1 rounded-pill" onclick="navegarA('miembros', '${mesaObj.numero}')">
                                Gestionar Miembros &rarr;
                            </button>
                            <button class="btn btn-outline-danger btn-sm rounded-circle px-2" title="Eliminar Mesa" onclick="confirmarEliminarMesa('${mesaObj.numero}')">
                                🗑️
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;
        contenedor.insertAdjacentHTML("beforeend", cardHTML);
    });
}

function abrirModalNuevaMesa() {
    document.getElementById("form-mesa")?.reset();
    const modalEl = document.getElementById("modalMesa");
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
}

async function guardarNuevaMesa(numero, localVotacion, distrito, aula) {
    const resp = await apiFetch('/api/mesas', {
        method: 'POST',
        body: JSON.stringify({ numero, localVotacion, distrito, aula })
    });

    if (!resp.ok) {
        alert(resp.data?.error || resp.error || "No se pudo guardar la mesa.");
        return false;
    }

    if (!sesionActiva.datos.mesas) sesionActiva.datos.mesas = [];
    sesionActiva.datos.mesas.push({
        numero: numero.trim(),
        localVotacion: localVotacion.trim(),
        distrito: distrito.trim(),
        aula: aula.trim()
    });

    // Ordenar mesas
    sesionActiva.datos.mesas.sort((a, b) => a.numero.localeCompare(b.numero));

    sincronizarTodoUI();
    return true;
}

async function confirmarEliminarMesa(numero) {
    const miembros = sesionActiva.datos.miembros.filter(m => m.mesa === numero);
    const mensaje = miembros.length > 0
        ? `¿Seguro que deseas eliminar la Mesa ${numero}? Se eliminarán también sus ${miembros.length} miembro(s).`
        : `¿Seguro que deseas eliminar la Mesa ${numero}?`;

    if (confirm(mensaje)) {
        const resp = await apiFetch(`/api/mesas/${encodeURIComponent(numero)}`, {
            method: 'DELETE'
        });

        if (!resp.ok) {
            alert(resp.data?.error || "Error al eliminar la mesa.");
            return;
        }

        sesionActiva.datos.mesas = sesionActiva.datos.mesas.filter(m => m.numero !== numero);
        sesionActiva.datos.miembros = sesionActiva.datos.miembros.filter(m => m.mesa !== numero);
        sincronizarTodoUI();
    }
}

// ==========================================
// 7. GESTIÓN DE MIEMBROS, DETALLE Y EDICIÓN
// ==========================================
function abrirModalNuevoMiembro() {
    if (sesionActiva.datos.mesas.length === 0) {
        alert("Primero debes registrar al menos una mesa electoral antes de agregar miembros.");
        abrirModalNuevaMesa();
        return;
    }

    document.getElementById("form-nuevo-miembro")?.reset();
    actualizarSelectoresMesas();
    const modalEl = document.getElementById("modalNuevoMiembro");
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
}

async function guardarNuevoMiembro(datos) {
    const payload = {
        mesa: datos.mesa,
        cargo: datos.cargo,
        dni: datos.dni,
        nombre: datos.nombre,
        telefono: datos.telefono,
        direccion: datos.direccion,
        viveEnDireccion: Boolean(datos.viveEnDireccion),
        contactado: false,
        credencial: false,
        capacitacion: false,
        visitaRealizada: false,
        visitaEstado: "no_visitado",
        visitaFecha: "",
        visitaObservaciones: "",
        observaciones: ""
    };

    const resp = await apiFetch('/api/miembros', {
        method: 'POST',
        body: JSON.stringify(payload)
    });

    if (!resp.ok) {
        alert(resp.data?.error || "Error al registrar el miembro de mesa.");
        return false;
    }

    payload.id = resp.data.id;
    if (!sesionActiva.datos.miembros) sesionActiva.datos.miembros = [];
    sesionActiva.datos.miembros.push(payload);

    sincronizarTodoUI();
    return true;
}

// Generar enlace dinámico de WhatsApp contextual
function generarEnlaceWhatsApp(miembro) {
    if (!miembro.telefono || miembro.telefono.trim() === "") return "#";

    let mensaje = "";
    if (!miembro.contactado) {
        mensaje = `Hola ${miembro.nombre || ''}, te saluda tu Coordinador/a de la ONPE. Me pongo en contacto para coordinar tu asignación como ${miembro.cargo} en la Mesa ${miembro.mesa}.`;
    } else if (!miembro.credencial) {
        mensaje = `Hola ${miembro.nombre || ''}, te recuerdo que tenemos pendiente la entrega oficial de tu credencial de miembro de mesa para la Mesa ${miembro.mesa}.`;
    } else if (!miembro.capacitacion) {
        mensaje = `Hola ${miembro.nombre || ''}, te recordamos realizar tu capacitación de miembro de mesa para la jornada electoral.`;
    } else {
        mensaje = `Hola ${miembro.nombre || ''}, confirmamos que tienes todas tus actividades listas para la jornada electoral en la Mesa ${miembro.mesa}. ¡Muchas gracias!`;
    }

    return `https://wa.me/51${miembro.telefono}?text=${encodeURIComponent(mensaje)}`;
}

// Renderizar tarjetas de miembros
function renderizarMiembros(miembros) {
    const contenedor = document.getElementById("contenedor-miembros");
    if (!contenedor) return;
    contenedor.innerHTML = "";

    if (!miembros || miembros.length === 0) {
        contenedor.innerHTML = `
            <div class="col-12 text-center py-5">
                <div class="p-4 bg-white rounded-4 shadow-sm border">
                    <p class="text-muted mb-0 fs-5">🔍 No se encontraron miembros registrados con los filtros aplicados.</p>
                </div>
            </div>`;
        return;
    }

    miembros.forEach(miembro => {
        const nombreDisplay = miembro.nombre && miembro.nombre.trim() !== ''
            ? miembro.nombre
            : `<span class="text-secondary fst-italic">[Pendiente de registro - ${miembro.cargo}]</span>`;

        const direccionDisplay = miembro.direccion && miembro.direccion.trim() !== ''
            ? `📍 ${miembro.direccion} ${miembro.viveEnDireccion ? '<span class="badge bg-success-subtle text-success-emphasis rounded-pill ms-1">Vive aquí</span>' : '<span class="badge bg-warning-subtle text-warning-emphasis rounded-pill ms-1">No vive aquí / Por verificar</span>'}`
            : `<span class="text-muted fst-italic">📍 Sin dirección registrada</span>`;

        // Badge de visita
        let badgeVisitaHTML = '<span class="badge bg-light text-secondary border rounded-pill">🏠 No visitado</span>';
        if (miembro.visitaEstado === 'segunda_visita') {
            badgeVisitaHTML = '<span class="badge bg-warning-subtle text-warning-emphasis rounded-pill">⚠️ Requiere 2da Visita</span>';
        } else if (miembro.visitaRealizada || miembro.visitaEstado === 'visitado') {
            badgeVisitaHTML = '<span class="badge bg-success-subtle text-success-emphasis rounded-pill">✅ Vivienda Visitada</span>';
        }

        const tarjetaHTML = `
            <div class="col-12 col-md-6 col-lg-4">
                <div class="card miembro-card shadow-sm h-100 border-0 border-start border-4 border-primary rounded-4" onclick="abrirModalDetalle('${miembro.id}')" title="Clic para ver ficha de consulta">
                    <div class="card-body d-flex flex-column p-3">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <span class="badge bg-primary-subtle text-primary-emphasis rounded-pill">${miembro.cargo}</span>
                            <span class="badge bg-light text-dark border">Mesa ${miembro.mesa}</span>
                        </div>

                        <h6 class="card-title fw-bold mb-1 text-truncate" title="${miembro.nombre || miembro.cargo}">${nombreDisplay}</h6>
                        <p class="card-subtitle text-muted mb-2 small">
                            DNI: <strong>${miembro.dni || 'S/N'}</strong>
                            ${miembro.telefono ? ` | Tel: <strong>${miembro.telefono}</strong>` : ''}
                        </p>

                        <div class="small mb-2 text-truncate" title="${miembro.direccion || ''}">
                            ${direccionDisplay}
                        </div>

                        <div class="mb-2">
                            ${badgeVisitaHTML}
                        </div>

                        <div class="mb-3 d-flex gap-1 flex-wrap">
                            <span class="badge rounded-pill ${miembro.contactado ? 'bg-success' : 'bg-secondary'}">Contacto</span>
                            <span class="badge rounded-pill ${miembro.credencial ? 'bg-success' : 'bg-secondary'}">Credencial</span>
                            <span class="badge rounded-pill ${miembro.capacitacion ? 'bg-success' : 'bg-secondary'}">Capacitación</span>
                        </div>

                        ${miembro.observaciones ? `<p class="small text-muted mb-3 fst-italic bg-light p-2 rounded">📝 ${miembro.observaciones}</p>` : ''}

                        <div class="d-flex justify-content-between align-items-center mt-auto pt-2 border-top" onclick="event.stopPropagation()">
                            <div class="d-flex gap-1">
                                ${miembro.telefono ? `<a href="${generarEnlaceWhatsApp(miembro)}" target="_blank" class="btn btn-outline-success btn-sm px-2 rounded-pill" title="WhatsApp">💬 WA</a>` : ''}
                                ${miembro.direccion ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(miembro.direccion + ', Lima, Peru')}" target="_blank" class="btn btn-outline-primary btn-sm px-2 rounded-pill" title="Abrir en Google Maps">📍 Maps</a>` : ''}
                            </div>
                            <button class="btn btn-primary btn-sm px-3 rounded-pill" onclick="abrirModalGestion('${miembro.id}')">✏️ Editar</button>
                        </div>
                    </div>
                </div>
            </div>`;
        contenedor.insertAdjacentHTML("beforeend", tarjetaHTML);
    });
}

// 7.1 FICHA DE CONSULTA COMPLETA (CLIC EN TARJETA - SOLO LECTURA)
function abrirModalDetalle(id) {
    const miembros = sesionActiva.datos.miembros || [];
    const miembro = miembros.find(m => m.id === id);
    if (!miembro) return;

    const body = document.getElementById("detalle-miembro-body");
    const footer = document.getElementById("detalle-acciones-footer");

    let estadoVisitaBadge = '<span class="badge bg-secondary rounded-pill">No visitado</span>';
    if (miembro.visitaEstado === 'segunda_visita') {
        estadoVisitaBadge = '<span class="badge bg-warning text-dark rounded-pill">Requiere segunda visita</span>';
    } else if (miembro.visitaRealizada || miembro.visitaEstado === 'visitado') {
        estadoVisitaBadge = '<span class="badge bg-success rounded-pill">Vivienda visitada</span>';
    }

    body.innerHTML = `
        <div class="row g-3">
            <div class="col-12 text-center p-3 bg-light rounded-4 border">
                <span class="badge bg-primary rounded-pill px-3 py-1 mb-2">${miembro.cargo}</span>
                <h4 class="fw-bold mb-1">${miembro.nombre || 'Nombre no registrado'}</h4>
                <p class="text-muted mb-0">Mesa Electoral: <strong>${miembro.mesa}</strong> | DNI: <strong>${miembro.dni || 'Sin DNI'}</strong></p>
            </div>

            <div class="col-12 col-md-6">
                <div class="p-3 border rounded-4 h-100 bg-white">
                    <h6 class="fw-bold text-primary mb-3">📍 Datos de Contacto y Vivienda</h6>
                    <p class="mb-2 small"><strong>Teléfono:</strong> ${miembro.telefono ? `<a href="tel:${miembro.telefono}">${miembro.telefono}</a>` : '<span class="text-muted">No registrado</span>'}</p>
                    <p class="mb-2 small"><strong>Dirección:</strong> ${miembro.direccion || '<span class="text-muted">No registrada</span>'}</p>
                    <p class="mb-2 small"><strong>¿Vive en dirección?:</strong> ${miembro.viveEnDireccion ? '<span class="text-success fw-bold">Sí</span>' : '<span class="text-danger">No / Por verificar</span>'}</p>
                    ${miembro.direccion ? `
                        <div class="mt-3">
                            <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(miembro.direccion + ', Lima, Peru')}" target="_blank" class="btn btn-outline-primary btn-sm rounded-pill w-100 py-2">
                                📍 Abrir en Google Maps
                            </a>
                        </div>` : ''}
                </div>
            </div>

            <div class="col-12 col-md-6">
                <div class="p-3 border rounded-4 h-100 bg-white">
                    <h6 class="fw-bold text-primary mb-3">🏠 Registro de Visitas Domiciliarias</h6>
                    <p class="mb-2 small"><strong>Estado de visita:</strong> ${estadoVisitaBadge}</p>
                    <p class="mb-2 small"><strong>Fecha y hora:</strong> ${miembro.visitaFecha ? new Date(miembro.visitaFecha).toLocaleString() : '<span class="text-muted">Sin visita registrada</span>'}</p>
                    <p class="mb-0 small"><strong>Observaciones de visita:</strong> ${miembro.visitaObservaciones ? miembro.visitaObservaciones : '<span class="text-muted">Sin incidencias</span>'}</p>
                </div>
            </div>

            <div class="col-12">
                <div class="p-3 border rounded-4 bg-white">
                    <h6 class="fw-bold text-primary mb-3">✅ Actividades Oficiales ONPE</h6>
                    <div class="row g-2 text-center">
                        <div class="col-4">
                            <div class="p-2 rounded-3 ${miembro.contactado ? 'bg-success-subtle text-success-emphasis' : 'bg-light text-muted border'}">
                                <small class="d-block">Contactado</small>
                                <strong>${miembro.contactado ? 'SÍ' : 'NO'}</strong>
                            </div>
                        </div>
                        <div class="col-4">
                            <div class="p-2 rounded-3 ${miembro.credencial ? 'bg-success-subtle text-success-emphasis' : 'bg-light text-muted border'}">
                                <small class="d-block">Credencial</small>
                                <strong>${miembro.credencial ? 'ENTREGADA' : 'PENDIENTE'}</strong>
                            </div>
                        </div>
                        <div class="col-4">
                            <div class="p-2 rounded-3 ${miembro.capacitacion ? 'bg-success-subtle text-success-emphasis' : 'bg-light text-muted border'}">
                                <small class="d-block">Capacitación</small>
                                <strong>${miembro.capacitacion ? 'COMPLETA' : 'PENDIENTE'}</strong>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            ${miembro.observaciones ? `
                <div class="col-12">
                    <div class="p-3 border rounded-4 bg-light">
                        <h6 class="fw-bold text-secondary mb-1 small">NOTAS GENERALES:</h6>
                        <p class="mb-0 small">${miembro.observaciones}</p>
                    </div>
                </div>` : ''}
        </div>`;

    footer.innerHTML = `
        ${miembro.telefono ? `<a href="${generarEnlaceWhatsApp(miembro)}" target="_blank" class="btn btn-success btn-sm rounded-pill px-3">💬 Enviar WhatsApp</a>` : ''}
        <button type="button" class="btn btn-primary btn-sm rounded-pill px-3" onclick="pasarDeConsultaAEdicion('${miembro.id}')">✏️ Editar Datos</button>
    `;

    const modalEl = document.getElementById("modalDetalleMiembro");
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
}

function pasarDeConsultaAEdicion(id) {
    const modalDetalleEl = document.getElementById("modalDetalleMiembro");
    const instanceDetalle = bootstrap.Modal.getOrCreateInstance(modalDetalleEl);
    if (instanceDetalle) instanceDetalle.hide();

    abrirModalGestion(id);
}

// 7.2 MODAL DE GESTIÓN Y EDICIÓN (INDEPENDIENTE)
function abrirModalGestion(id) {
    const miembros = sesionActiva.datos.miembros || [];
    const miembro = miembros.find(m => m.id === id);
    if (!miembro) return;

    actualizarSelectoresMesas();

    document.getElementById("gestion-id").value = miembro.id;
    document.getElementById("gestion-mesa-select").value = miembro.mesa;
    document.getElementById("gestion-cargo-select").value = miembro.cargo;

    document.getElementById("gestion-nombre").value = miembro.nombre || "";
    document.getElementById("gestion-dni").value = miembro.dni || "";
    document.getElementById("gestion-telefono").value = miembro.telefono || "";
    document.getElementById("gestion-direccion").value = miembro.direccion || "";
    document.getElementById("check-vive-direccion").checked = Boolean(miembro.viveEnDireccion);

    // Registro de Visitas
    document.getElementById("check-visita-realizada").checked = Boolean(miembro.visitaRealizada || miembro.visitaEstado === 'visitado');
    document.getElementById("select-visita-estado").value = miembro.visitaEstado || "no_visitado";
    document.getElementById("gestion-visita-fecha").value = miembro.visitaFecha || "";
    document.getElementById("gestion-visita-obs").value = miembro.visitaObservaciones || "";

    // Actividades ONPE
    document.getElementById("check-contactado").checked = Boolean(miembro.contactado);
    document.getElementById("check-credencial").checked = Boolean(miembro.credencial);
    document.getElementById("check-capacitacion").checked = Boolean(miembro.capacitacion);

    // Observaciones
    document.getElementById("text-observaciones").value = miembro.observaciones || "";

    const modalEl = document.getElementById("modalGestion");
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
}

async function confirmarEliminarMiembro() {
    const id = document.getElementById("gestion-id").value;
    if (!id) return;

    if (confirm("¿Estás seguro de que deseas eliminar este miembro de mesa?")) {
        const resp = await apiFetch(`/api/miembros/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });

        if (!resp.ok) {
            alert(resp.data?.error || "Error al eliminar el miembro de mesa.");
            return;
        }

        sesionActiva.datos.miembros = sesionActiva.datos.miembros.filter(m => m.id !== id);

        const modalEl = document.getElementById("modalGestion");
        const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
        if (modalInstance) modalInstance.hide();

        sincronizarTodoUI();
    }
}

// ==========================================
// 8. FILTROS Y BÚSQUEDA AMPLIA
// ==========================================
function aplicarFiltros() {
    if (!sesionActiva.autenticado) return;

    const todos = sesionActiva.datos.miembros || [];
    const busqueda = (document.getElementById("input-busqueda")?.value || "").toLowerCase().trim();
    const mesa = document.getElementById("filtro-mesa")?.value || "";
    const cargo = document.getElementById("filtro-cargo")?.value || "";
    const estado = document.getElementById("filtro-estado")?.value || "";

    const filtrados = todos.filter(m => {
        // Búsqueda por DNI, Nombre o Dirección
        let coincideBusqueda = true;
        if (busqueda) {
            const dni = (m.dni || '').toLowerCase();
            const nombre = (m.nombre || '').toLowerCase();
            const direccion = (m.direccion || '').toLowerCase();
            coincideBusqueda = dni.includes(busqueda) || nombre.includes(busqueda) || direccion.includes(busqueda);
        }

        // Filtro Mesa
        const coincideMesa = !mesa || m.mesa === mesa;

        // Filtro Cargo
        const coincideCargo = !cargo || m.cargo === cargo;

        // Filtro Estado / Visitas
        let coincideEstado = true;
        if (estado === "visita-realizada") {
            coincideEstado = Boolean(m.visitaRealizada || m.visitaEstado === 'visitado');
        } else if (estado === "visita-pendiente") {
            coincideEstado = !m.visitaRealizada && m.visitaEstado !== 'visitado';
        } else if (estado === "visita-segunda") {
            coincideEstado = m.visitaEstado === 'segunda_visita';
        } else if (estado === "visita-obs") {
            coincideEstado = Boolean(m.visitaObservaciones && m.visitaObservaciones.trim() !== '');
        } else if (estado === "es-contactado") {
            coincideEstado = Boolean(m.contactado);
        } else if (estado === "es-credencial") {
            coincideEstado = Boolean(m.credencial);
        } else if (estado === "es-capacitacion") {
            coincideEstado = Boolean(m.capacitacion);
        } else if (estado === "completado-todo") {
            coincideEstado = Boolean(m.contactado && m.credencial && m.capacitacion);
        } else if (estado === "vive-aqui") {
            coincideEstado = Boolean(m.direccion && m.viveEnDireccion);
        } else if (estado === "falta-contacto") {
            coincideEstado = !m.contactado;
        } else if (estado === "falta-credencial") {
            coincideEstado = !m.credencial;
        } else if (estado === "falta-capacitacion") {
            coincideEstado = !m.capacitacion;
        } else if (estado === "no-vive") {
            coincideEstado = Boolean(m.direccion && !m.viveEnDireccion);
        }

        return coincideBusqueda && coincideMesa && coincideCargo && coincideEstado;
    });

    renderizarMiembros(filtrados);
}

// ==========================================
// 9. ESCÁNER DE CREDENCIALES CON CÁMARA / OCR
// ==========================================
function abrirModalEscanearCredencial() {
    if (sesionActiva.datos.mesas.length === 0) {
        alert("Primero debes registrar al menos una mesa antes de escanear credenciales.");
        abrirModalNuevaMesa();
        return;
    }

    actualizarSelectoresMesas();
    document.getElementById("scanner-progress-container")?.classList.add("d-none");
    document.getElementById("scanner-resultado-container")?.classList.add("d-none");
    document.getElementById("contenedor-stream-cam")?.classList.add("d-none");
    document.getElementById("btn-capturar-frame")?.classList.add("d-none");
    document.getElementById("btn-iniciar-camara")?.classList.remove("d-none");

    const modalEl = document.getElementById("modalEscanearCredencial");
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
}

function procesarFotoArchivo(event) {
    const file = event.target.files[0];
    if (!file) return;

    detenerCamaraStream();
    const reader = new FileReader();
    reader.onload = function(e) {
        ejecutarOCREnImagen(e.target.result);
    };
    reader.readAsDataURL(file);
}

async function iniciarCamaraStream() {
    const contenedor = document.getElementById("contenedor-stream-cam");
    const video = document.getElementById("video-preview-cam");
    const btnCapturar = document.getElementById("btn-capturar-frame");
    const btnIniciar = document.getElementById("btn-iniciar-camara");

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" },
            audio: false
        });
        streamCamaraActivo = stream;
        video.srcObject = stream;
        contenedor.classList.remove("d-none");
        btnCapturar.classList.remove("d-none");
        btnIniciar.classList.add("d-none");
    } catch (err) {
        console.error("Error accediendo a cámara:", err);
        alert("No se pudo acceder a la cámara en vivo. Puedes utilizar la opción de seleccionar foto.");
    }
}

function capturarFrameCamara() {
    const video = document.getElementById("video-preview-cam");
    if (!video || !streamCamaraActivo) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    detenerCamaraStream();
    const dataURL = canvas.toDataURL("image/jpeg", 0.9);
    ejecutarOCREnImagen(dataURL);
}

function detenerCamaraStream() {
    if (streamCamaraActivo) {
        streamCamaraActivo.getTracks().forEach(track => track.stop());
        streamCamaraActivo = null;
    }
    const contenedor = document.getElementById("contenedor-stream-cam");
    if (contenedor) contenedor.classList.add("d-none");
    const btnCapturar = document.getElementById("btn-capturar-frame");
    if (btnCapturar) btnCapturar.classList.add("d-none");
    const btnIniciar = document.getElementById("btn-iniciar-camara");
    if (btnIniciar) btnIniciar.classList.remove("d-none");
}

async function ejecutarOCREnImagen(imagenSrc) {
    const progressContainer = document.getElementById("scanner-progress-container");
    const progressBar = document.getElementById("scanner-progress-bar");
    const progressPercent = document.getElementById("scanner-progress-percent");
    const statusText = document.getElementById("scanner-status-text");
    const resultadoContainer = document.getElementById("scanner-resultado-container");

    progressContainer?.classList.remove("d-none");
    resultadoContainer?.classList.add("d-none");

    try {
        if (typeof Tesseract === 'undefined') {
            throw new Error("Motor Tesseract no cargado.");
        }

        const { data } = await Tesseract.recognize(imagenSrc, 'spa+eng', {
            logger: m => {
                if (m.status === 'recognizing text') {
                    const pct = Math.round((m.progress || 0) * 100);
                    if (progressBar) progressBar.style.width = pct + "%";
                    if (progressPercent) progressPercent.textContent = pct + "%";
                    if (statusText) statusText.textContent = "Reconociendo texto de credencial...";
                }
            }
        });

        progressContainer?.classList.add("d-none");
        parsearTextoCredencial(data.text);
    } catch (e) {
        console.error("Error OCR:", e);
        progressContainer?.classList.add("d-none");
        alert("Ocurrió un error al procesar la imagen con OCR. Puedes ingresar los datos manualmente.");
    }
}

// Extracción estricta de credencial ONPE sin inventar datos
function parsearTextoCredencial(textoCrudo) {
    const resultadoContainer = document.getElementById("scanner-resultado-container");
    resultadoContainer?.classList.remove("d-none");

    const lineas = textoCrudo.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    // 1. DNI (8 dígitos)
    let dniDetectado = "";
    const dniMatch = textoCrudo.match(/\b(\d{8})\b/);
    if (dniMatch) dniDetectado = dniMatch[1];

    // 2. Mesa (6 dígitos)
    let mesaDetectada = "";
    const mesaMatch = textoCrudo.match(/\b(?:mesa|n[°o]\s*mesa)?[:\s]*(\d{6})\b/i);
    if (mesaMatch) mesaDetectada = mesaMatch[1];

    // 3. Cargo
    let cargoDetectado = "Presidente";
    const textoUpper = textoCrudo.toUpperCase();
    if (textoUpper.includes("PRESIDENT")) cargoDetectado = "Presidente";
    else if (textoUpper.includes("SECRETARI")) cargoDetectado = "Secretaria";
    else if (textoUpper.includes("TERCER MIEMBRO") || textoUpper.includes("3ER MIEMBRO")) cargoDetectado = "Tercer Miembro";
    else if (textoUpper.includes("PRIMER SUPLENTE") || textoUpper.includes("1ER SUPLENTE")) cargoDetectado = "Primer Suplente";
    else if (textoUpper.includes("SEGUNDO SUPLENTE") || textoUpper.includes("2DO SUPLENTE")) cargoDetectado = "Segundo Suplente";
    else if (textoUpper.includes("TERCER SUPLENTE") || textoUpper.includes("3ER SUPLENTE")) cargoDetectado = "Tercer Suplente";
    else if (textoUpper.includes("CUARTO SUPLENTE") || textoUpper.includes("4TO SUPLENTE")) cargoDetectado = "Cuarto Suplente";
    else if (textoUpper.includes("QUINTO SUPLENTE") || textoUpper.includes("5TO SUPLENTE")) cargoDetectado = "Quinto Suplente";
    else if (textoUpper.includes("SEXTO SUPLENTE") || textoUpper.includes("6TO SUPLENTE")) cargoDetectado = "Sexto Suplente";

    // 4. Nombre y Dirección
    let nombreDetectado = "";
    let direccionDetectada = "";

    lineas.forEach(linea => {
        const u = linea.toUpperCase();
        if (/\b(JR|AV|AVENIDA|CALLE|PASAJE|PSJ|PROLONGACION|BLOCK|MZ|URB)\b/i.test(u) && !direccionDetectada) {
            direccionDetectada = linea;
        }
        if (!nombreDetectado && (linea.includes(",") || /^[A-ZÁÉÍÓÚÑ\s]{10,}$/.test(linea)) && !u.includes("ONPE") && !u.includes("CREDENCIAL") && !u.includes("ELECTORAL")) {
            nombreDetectado = linea;
        }
    });

    const selectMesa = document.getElementById("ocr-mesa");
    if (selectMesa) {
        if (mesaDetectada && Array.from(selectMesa.options).some(o => o.value === mesaDetectada)) {
            selectMesa.value = mesaDetectada;
        } else if (selectMesa.options.length > 0) {
            selectMesa.selectedIndex = 0;
        }
    }

    const elCargo = document.getElementById("ocr-cargo");
    if (elCargo) elCargo.value = cargoDetectado;
    const elDni = document.getElementById("ocr-dni");
    if (elDni) elDni.value = dniDetectado;
    const elNom = document.getElementById("ocr-nombre");
    if (elNom) elNom.value = nombreDetectado;
    const elDir = document.getElementById("ocr-direccion");
    if (elDir) elDir.value = direccionDetectada;
    const elTel = document.getElementById("ocr-telefono");
    if (elTel) elTel.value = "";
}

// ==========================================
// 10. MAPA Y PLANIFICACIÓN DE VISITAS (GOOGLE MAPS)
// ==========================================
function renderizarMapaVisitas() {
    if (!sesionActiva.autenticado) return;

    const contenedor = document.getElementById("contenedor-lista-mapa");
    if (!contenedor) return;
    contenedor.innerHTML = "";

    const todos = sesionActiva.datos.miembros || [];
    const filtroMesa = document.getElementById("mapa-filtro-mesa")?.value || "";
    const miembros = filtroMesa ? todos.filter(m => m.mesa === filtroMesa) : todos;

    const conDireccion = miembros.filter(m => m.direccion && m.direccion.trim() !== '');
    const visitados = conDireccion.filter(m => m.visitaRealizada || m.visitaEstado === 'visitado').length;
    const segundas = conDireccion.filter(m => m.visitaEstado === 'segunda_visita').length;
    const pendientes = conDireccion.length - visitados;

    const elTotalDir = document.getElementById("mapa-stat-total-dir");
    if (elTotalDir) elTotalDir.textContent = conDireccion.length;
    const elVis = document.getElementById("mapa-stat-visitados");
    if (elVis) elVis.textContent = visitados;
    const elPend = document.getElementById("mapa-stat-pendientes");
    if (elPend) elPend.textContent = pendientes;
    const elSeg = document.getElementById("mapa-stat-segunda");
    if (elSeg) elSeg.textContent = segundas;

    if (conDireccion.length === 0) {
        contenedor.innerHTML = `
            <div class="col-12 text-center py-4 text-muted">
                No hay miembros con dirección registrada para la mesa seleccionada.
            </div>`;
        return;
    }

    conDireccion.forEach(m => {
        let estadoBadge = '<span class="badge bg-secondary rounded-pill">No visitado</span>';
        let estaPendiente = true;

        if (m.visitaEstado === 'segunda_visita') {
            estadoBadge = '<span class="badge bg-warning text-dark rounded-pill">Requiere 2da Visita</span>';
        } else if (m.visitaRealizada || m.visitaEstado === 'visitado') {
            estadoBadge = '<span class="badge bg-success rounded-pill">Visitado</span>';
            estaPendiente = false;
        }

        const itemHTML = `
            <div class="col-12 col-md-6">
                <div class="card p-3 rounded-4 border shadow-sm h-100 bg-white d-flex flex-column">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <div class="form-check">
                            <input class="form-check-input check-ruta-miembro" type="checkbox" value="${encodeURIComponent(m.direccion + ', Lima, Peru')}" id="chk-ruta-${m.id}" ${estaPendiente ? 'checked' : ''}>
                            <label class="form-check-label fw-bold small" for="chk-ruta-${m.id}">
                                ${m.nombre || m.cargo}
                            </label>
                        </div>
                        ${estadoBadge}
                    </div>

                    <p class="small text-muted mb-2">
                        Mesa: <strong>${m.mesa}</strong> | Cargo: <strong>${m.cargo}</strong>
                        ${m.telefono ? ` | Tel: <a href="tel:${m.telefono}">${m.telefono}</a>` : ''}
                    </p>

                    <p class="small mb-3">
                        📍 <strong>${m.direccion}</strong>
                    </p>

                    <div class="mt-auto">
                        <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.direccion + ', Lima, Peru')}" target="_blank" class="btn btn-outline-primary btn-sm rounded-pill w-100">
                            📍 Abrir en Google Maps
                        </a>
                    </div>
                </div>
            </div>`;
        contenedor.insertAdjacentHTML("beforeend", itemHTML);
    });
}

function seleccionarTodosParaRuta(marcar) {
    document.querySelectorAll(".check-ruta-miembro").forEach(cb => {
        cb.checked = Boolean(marcar);
    });
}

// Abrir ruta con paradas en Google Maps
function abrirRutaOptimizadaGoogleMaps() {
    const seleccionados = Array.from(document.querySelectorAll(".check-ruta-miembro:checked")).map(cb => decodeURIComponent(cb.value));

    if (seleccionados.length === 0) {
        alert("Selecciona al menos una vivienda para generar la ruta.");
        return;
    }

    if (seleccionados.length === 1) {
        window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(seleccionados[0])}`, '_blank');
        return;
    }

    const destinoFinal = seleccionados[seleccionados.length - 1];
    const paradasIntermedias = seleccionados.slice(0, seleccionados.length - 1).join('|');

    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destinoFinal)}&waypoints=${encodeURIComponent(paradasIntermedias)}`;
    window.open(url, '_blank');
}

// ==========================================
// 11. RESPALDO Y EXPORTACIÓN JSON
// ==========================================
async function exportarDatosJSON() {
    if (!sesionActiva.autenticado) return;

    const resp = await apiFetch('/api/backup');
    let datosExportar;
    if (resp.ok && resp.data) {
        datosExportar = resp.data;
    } else {
        datosExportar = {
            coordinador: sesionActiva.nombre,
            usuario: sesionActiva.usuario,
            fechaRespaldo: new Date().toISOString(),
            mesas: sesionActiva.datos.mesas,
            miembros: sesionActiva.datos.miembros
        };
    }

    const blob = new Blob([JSON.stringify(datosExportar, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `respaldo_onpe_${sesionActiva.usuario}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==========================================
// 12. INICIALIZACIÓN Y EVENT LISTENERS
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
    // 1. Restaurar sesión existente si el usuario tenía sesión activa
    await restaurarSesionActiva();

    // 2. Formulario de Inicio de Sesión
    document.getElementById("form-login")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const usuario = document.getElementById("login-usuario").value;
        const pass = document.getElementById("login-password").value;
        const btn = document.getElementById("btn-submit-login");

        btn.disabled = true;
        btn.textContent = "Ingresando...";
        await iniciarSesion(usuario, pass);
        btn.disabled = false;
        btn.textContent = "Ingresar";
    });

    // 3. Formulario de Registro
    document.getElementById("form-registro")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const nombre = document.getElementById("reg-nombre").value;
        const usuario = document.getElementById("reg-usuario").value;
        const pass = document.getElementById("reg-password").value;
        const passConfirm = document.getElementById("reg-password-confirm").value;

        if (pass !== passConfirm) {
            mostrarAuthAlert("Las contraseñas ingresadas no coinciden.");
            return;
        }

        const btn = document.getElementById("btn-submit-registro");
        btn.disabled = true;
        btn.textContent = "Creando cuenta...";
        await registrarCoordinador(nombre, usuario, pass);
        btn.disabled = false;
        btn.textContent = "Crear cuenta";
    });

    // 4. Formulario de Nueva Mesa
    document.getElementById("form-mesa")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const numero = document.getElementById("nueva-mesa-numero").value.trim();
        const localVotacion = document.getElementById("nueva-mesa-local").value.trim();
        const distrito = document.getElementById("nueva-mesa-distrito").value.trim();
        const aula = document.getElementById("nueva-mesa-aula").value.trim();

        if (!/^\d{6}$/.test(numero)) {
            alert("El número de mesa debe contener exactamente 6 dígitos numéricos.");
            return;
        }

        const ok = await guardarNuevaMesa(numero, localVotacion, distrito, aula);
        if (ok) {
            const modalEl = document.getElementById("modalMesa");
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.hide();
        }
    });

    // 5. Formulario de Nuevo Miembro Manual
    document.getElementById("form-nuevo-miembro")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const mesa = document.getElementById("nuevo-miembro-mesa").value;
        const cargo = document.getElementById("nuevo-miembro-cargo").value;
        const nombre = document.getElementById("nuevo-miembro-nombre").value.trim();
        const dni = document.getElementById("nuevo-miembro-dni").value.trim();
        const telefono = document.getElementById("nuevo-miembro-telefono").value.trim();
        const direccion = document.getElementById("nuevo-miembro-direccion").value.trim();
        const viveEnDireccion = document.getElementById("nuevo-check-vive").checked;

        await guardarNuevoMiembro({
            mesa, cargo, nombre, dni, telefono, direccion, viveEnDireccion
        });

        const modalEl = document.getElementById("modalNuevoMiembro");
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.hide();
    });

    // 6. Formulario de Confirmación de Miembro desde Escáner OCR
    document.getElementById("form-scanner-guardar")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const mesa = document.getElementById("ocr-mesa").value;
        const cargo = document.getElementById("ocr-cargo").value;
        const nombre = document.getElementById("ocr-nombre").value.trim();
        const dni = document.getElementById("ocr-dni").value.trim();
        const telefono = document.getElementById("ocr-telefono").value.trim();
        const direccion = document.getElementById("ocr-direccion").value.trim();

        await guardarNuevoMiembro({
            mesa, cargo, nombre, dni, telefono, direccion, viveEnDireccion: false
        });

        const modalEl = document.getElementById("modalEscanearCredencial");
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.hide();
    });

    // 7. Formulario de Gestión / Edición de Miembro
    document.getElementById("form-gestion")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = document.getElementById("gestion-id").value;
        const miembro = sesionActiva.datos.miembros.find(m => m.id === id);
        if (!miembro) return;

        const updateData = {
            mesa: document.getElementById("gestion-mesa-select").value,
            cargo: document.getElementById("gestion-cargo-select").value,
            nombre: document.getElementById("gestion-nombre").value.trim(),
            dni: document.getElementById("gestion-dni").value.trim(),
            telefono: document.getElementById("gestion-telefono").value.trim(),
            direccion: document.getElementById("gestion-direccion").value.trim(),
            viveEnDireccion: document.getElementById("check-vive-direccion").checked,

            // Visita
            visitaRealizada: document.getElementById("check-visita-realizada").checked,
            visitaEstado: document.getElementById("select-visita-estado").value,
            visitaFecha: document.getElementById("gestion-visita-fecha").value,
            visitaObservaciones: document.getElementById("gestion-visita-obs").value.trim(),

            // Actividades ONPE
            contactado: document.getElementById("check-contactado").checked,
            credencial: document.getElementById("check-credencial").checked,
            capacitacion: document.getElementById("check-capacitacion").checked,
            observaciones: document.getElementById("text-observaciones").value.trim()
        };

        if (updateData.visitaRealizada && updateData.visitaEstado === "no_visitado") {
            updateData.visitaEstado = "visitado";
        }

        const resp = await apiFetch(`/api/miembros/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify(updateData)
        });

        if (!resp.ok) {
            alert(resp.data?.error || "Error al actualizar los datos del miembro de mesa.");
            return;
        }

        Object.assign(miembro, updateData);

        const modalEl = document.getElementById("modalGestion");
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.hide();

        sincronizarTodoUI();
    });

    // 8. Listeners de Filtros
    document.getElementById("dashboard-filtro-mesa")?.addEventListener("change", () => {
        renderizarDashboard();
    });

    document.getElementById("input-busqueda")?.addEventListener("input", aplicarFiltros);
    document.getElementById("filtro-mesa")?.addEventListener("change", aplicarFiltros);
    document.getElementById("filtro-cargo")?.addEventListener("change", aplicarFiltros);
    document.getElementById("filtro-estado")?.addEventListener("change", aplicarFiltros);

    document.getElementById("btn-limpiar")?.addEventListener("click", () => {
        document.getElementById("input-busqueda").value = "";
        document.getElementById("filtro-mesa").value = "";
        document.getElementById("filtro-cargo").value = "";
        document.getElementById("filtro-estado").value = "";
        aplicarFiltros();
    });
});
