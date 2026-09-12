# 🗳️ Sistema de Gestión de Miembros de Mesa - ONPE 2026

Aplicación web estática y responsiva (Mobile-First) diseñada para la coordinación, seguimiento y administración operativa de miembros de mesa electoral para la Oficina Nacional de Procesos Electorales (ONPE).

## 📌 Mesas Electorales Asignadas
* **Mesa 043649** (9 Miembros: 3 Titulares y 6 Suplentes)
* **Mesa 043650** (9 Miembros: 3 Titulares y 6 Suplentes)
* **Mesa 043651** (9 Miembros: 3 Titulares y 6 Suplentes)

---

## 🚀 Funcionalidades Principales

1. **Dashboard de Estadísticas e Indicadores (KPIs):**
   * Conteo en tiempo real de Total de Miembros, Contactados, Credenciales Entregadas y Capacitados.
   * Barra de progreso porcentual y resumen de actividades pendientes.
   * Selector dinámico para filtrar métricas por mesa electoral.

2. **Gestión Agregada por Mesa:**
   * Vista general del cumplimiento de cada una de las 3 mesas de votación.
   * Botón de acceso contextual para filtrar automáticamente los miembros de la mesa seleccionada.

3. **Gestión Individual de Miembros:**
   * Ficha de datos personales con información de la credencial oficial (DNI, Dirección, Residencia).
   * Seguimiento de estado ONPE (Contactado, Credencial, Capacitación) y notas de campo.
   * Integración directa con **WhatsApp Web / App** con mensajes dinámicos contextuales según el estado del miembro.
   * Filtros combinados por Mesa, Cargo, Dirección y Estado (positivos y pendientes).

4. **Respaldo y Persistencia de Datos:**
   * Persistencia local en `LocalStorage`.
   * Botón integrado para descargar una copia de seguridad en formato `JSON` en cualquier momento.

---

## 🛠️ Tecnologías Utilizadas
* **HTML5** (Semántica moderna y estructura SPA)
* **CSS3 & Bootstrap 5.3.3** (Diseño Mobile-First, grillas responsivas y utilidades)
* **JavaScript Vanilla (ES6+)** (Lógica de filtrado, persistencia, modal dinámico y WhatsApp API)
