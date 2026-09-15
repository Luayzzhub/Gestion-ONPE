# 🗳️ Sistema de Gestión de Miembros de Mesa - ONPE 2026 (Lima Oeste 1)

Plataforma web responsiva (Mobile-First) y **Cloud-Ready** diseñada para la coordinación, seguimiento y administración operativa de miembros de mesa electoral para la Oficina Nacional de Procesos Electorales (ONPE).

Preparada para funcionar **24/7 en internet**, accesible desde celulares por **Wi-Fi o datos móviles (4G/5G)** y computadoras (navegación normal o modo incógnito), sin depender de que tu laptop personal esté encendida.

---

## 🔒 1. Arquitectura Cloud-Ready y Seguridad Centralizada
* **Persistencia en la Nube:** Base de datos relacional SQLite con modo WAL y transacciones ACID. Los datos no se pierden al cerrar el navegador ni al usar modo incógnito.
* **Aislamiento Estricto por Coordinador:** Cada coordinador registra su propia cuenta y visualiza/modifica únicamente sus propias mesas y miembros (`WHERE coordinador_id = ?`).
* **Seguridad de Contraseñas:** Hashing criptográfico mediante `scrypt` con `salt` individual de 16 bytes. Las contraseñas nunca se almacenan en texto plano.
* **Sesiones Seguras:** Autenticación por Bearer Tokens con revocación inmediata al cerrar sesión.
* **Rutas Relativas (`/api/...`):** El frontend consume la API automáticamente tanto en local (`http://localhost:3000`) como en producción (`https://tu-dominio.com`) sin cambiar una sola línea de código.

---

## 🚀 2. Funcionalidades Principales

1. **Gestión Dinámica de Mesas y Miembros:**
   * Registro dinámico de mesas electorales (código de 6 dígitos, local de votación, distrito y aula).
   * Registro individual de miembros con asignación de cargo oficial.
   * Sin datos estáticos. Cada nueva cuenta inicia limpia desde cero.

2. **Escáner de Credenciales con Cámara / OCR:**
   * Reconocimiento de credenciales oficiales ONPE con **Tesseract.js**.
   * Detección de DNI (8 dígitos), Mesa (6 dígitos), Cargo y Domicilio.
   * Enfoque dual: captura mediante cámara en vivo del celular o selección de fotografía desde galería.

3. **Registro y Control de Visitas Domiciliarias:**
   * Control de visitas a viviendas: *No visitado*, *Vivienda visitada* y *Requiere segunda visita*.
   * Registro de fecha, hora y observaciones de incidencias domiciliarias.

4. **Geolocalización y Rutas con Google Maps:**
   * Botón unificado institucional **`[ 📍 Abrir en Google Maps ]`** en tarjetas y ficha de consulta.
   * **Planificador de Recorridos:** Selección de miembros pendientes y generación de rutas optimizadas con paradas intermedias (*waypoints*).

5. **Dashboard Interactivo:**
   * KPIs en tiempo real (Total Miembros, Contactados, Credenciales, Capacitados, Visitas).
   * Tarjetas interactivas que filtran la lista de miembros con un solo clic.
   * Barra de progreso porcentual general.

6. **Ficha de Consulta vs. Edición:**
   * **Clic en la tarjeta:** Abre una ficha de consulta institucional de solo lectura.
   * **Botón "Editar":** Acceso al formulario de gestión.
   * Integración directa con **WhatsApp Web / App** con mensajes dinámicos contextualizados.

7. **Respaldo de Datos:**
   * Exportación de copia de seguridad oficial en formato `JSON` verificada por el servidor.

---

## 💻 3. Ejecución Local

Para ejecutar el servidor en tu computadora:

```bash
# 1. Iniciar el servidor
node server.js
# O usando npm:
npm start

# 2. Abrir en tu navegador
http://localhost:3000
```

> **Acceso desde tu celular en la misma red Wi-Fi:**
> Abre en tu celular: `http://<IP-DE-TU-PC>:3000` (ejemplo: `http://192.168.1.50:3000`).

---

## ☁️ 4. Despliegue en la Nube (Acceso 24/7 con HTTPS)

Para que todos los coordinadores puedan ingresar desde sus celulares por datos móviles o Wi-Fi sin que tu laptop esté encendida:

### Opción Rápida: Render.com (Plan Gratuito con HTTPS)
1. Sube tu proyecto a un repositorio de GitHub (ej. `Luayzzhub/Gestion-ONPE`).
2. Ingresa a [render.com](https://render.com) y crea una cuenta.
3. Haz clic en **New +** -> **Web Service**.
4. Conecta tu repositorio de GitHub.
5. Configura los parámetros:
   * **Runtime:** `Node`
   * **Build Command:** *(dejar vacío o `npm install`)*
   * **Start Command:** `node server.js`
   * **Plan:** `Free`
6. Haz clic en **Create Web Service**. ¡Listo! Render te generará una URL pública con HTTPS (ej. `https://gestion-onpe.onrender.com`) accesible por todos los coordinadores en cualquier momento.

---

## 🛠️ Tecnologías Utilizadas
* **Backend:** Node.js (Servidor HTTP nativo, criptografía `scrypt`, API REST)
* **Base de Datos:** SQLite nativo (`node:sqlite`) con transacciones ACID y modo WAL
* **Frontend:** HTML5 semántico, Bootstrap 5.3.3 (Mobile-First), JavaScript Vanilla ES6+
* **OCR:** Tesseract.js v5

