/**
 * SERVIDOR BACKEND CENTRALIZADO - GESTIÓN ONPE 2026 (LIMA OESTE 1)
 * Cloud-Ready: Diseñado para ejecutarse 24/7 en internet (Render, Railway, VPS) o en desarrollo local.
 * Soporta conexiones desde celulares (Wi-Fi y datos móviles 4G/5G) y navegadores (normal o incógnito).
 * Base de Datos Relacional Centralizada con transacciones ACID (SQLite).
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Puerto configurable por variable de entorno (necesario para Render, Railway, Heroku, etc.)
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Escuchar en todas las interfaces para permitir acceso desde celulares en red

// Directorio base y datos
const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
const DB_FILE = process.env.DATABASE_PATH || path.join(DATA_DIR, 'onpe.db');

// ==========================================
// 1. INICIALIZACIÓN DE BASE DE DATOS SQLITE
// ==========================================
let db;
try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(DB_FILE);
    db.exec(`PRAGMA journal_mode = WAL;`);
    db.exec(`PRAGMA foreign_keys = ON;`);
} catch (e) {
    console.error("Error cargando node:sqlite:", e);
    process.exit(1);
}

// Crear tablas si no existen
db.exec(`
    CREATE TABLE IF NOT EXISTS coordinadores (
        id TEXT PRIMARY KEY,
        nombre TEXT NOT NULL,
        usuario TEXT UNIQUE NOT NULL COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sesiones (
        token TEXT PRIMARY KEY,
        coordinador_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (coordinador_id) REFERENCES coordinadores(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mesas (
        id TEXT PRIMARY KEY,
        coordinador_id TEXT NOT NULL,
        numero TEXT NOT NULL,
        local_votacion TEXT,
        distrito TEXT,
        aula TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (coordinador_id) REFERENCES coordinadores(id) ON DELETE CASCADE,
        UNIQUE (coordinador_id, numero)
    );

    CREATE TABLE IF NOT EXISTS miembros (
        id TEXT PRIMARY KEY,
        coordinador_id TEXT NOT NULL,
        mesa TEXT NOT NULL,
        cargo TEXT NOT NULL,
        nombre TEXT NOT NULL,
        dni TEXT,
        telefono TEXT,
        direccion TEXT,
        vive_en_direccion INTEGER DEFAULT 0,
        contactado INTEGER DEFAULT 0,
        credencial INTEGER DEFAULT 0,
        capacitacion INTEGER DEFAULT 0,
        capacitacion_1 INTEGER DEFAULT 0,
        capacitacion_2 INTEGER DEFAULT 0,
        asiste_elecciones TEXT DEFAULT 'pendiente',
        visita_realizada INTEGER DEFAULT 0,
        visita_estado TEXT DEFAULT 'no_visitado',
        visita_fecha TEXT,
        visita_observaciones TEXT,
        observaciones TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (coordinador_id) REFERENCES coordinadores(id) ON DELETE CASCADE
    );
`);

// Migraciones automáticas e idempotentes para bases de datos existentes
try { db.exec(`ALTER TABLE miembros ADD COLUMN capacitacion_1 INTEGER DEFAULT 0;`); } catch(e) {}
try { db.exec(`ALTER TABLE miembros ADD COLUMN capacitacion_2 INTEGER DEFAULT 0;`); } catch(e) {}
try { db.exec(`ALTER TABLE miembros ADD COLUMN asiste_elecciones TEXT DEFAULT 'pendiente';`); } catch(e) {}

console.log("✓ Base de datos SQLite inicializada correctamente en:", DB_FILE);

// ==========================================
// 2. UTILIDADES DE SEGURIDAD Y AUTH
// ==========================================
function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

function generarToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Obtener coordinador autenticado a partir del header Authorization
function autenticarRequest(req) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

    const token = authHeader.substring(7).trim();
    if (!token) return null;

    const stmt = db.prepare(`
        SELECT c.id, c.nombre, c.usuario 
        FROM sesiones s
        JOIN coordinadores c ON s.coordinador_id = c.id
        WHERE s.token = ?
    `);
    const coord = stmt.get(token);
    return coord || null;
}

// Parsear cuerpo JSON
function leerJSONBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 5 * 1024 * 1024) { // límite de 5MB
                reject(new Error("Payload demasiado grande"));
            }
        });
        req.on('end', () => {
            if (!body.trim()) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(new Error("JSON inválido"));
            }
        });
        req.on('error', err => reject(err));
    });
}

// Enviar respuesta JSON
function responderJSON(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
    });
    res.end(JSON.stringify(data));
}

// ==========================================
// 3. ENRUTADOR HTTP
// ==========================================
const server = http.createServer(async (req, res) => {
    // Manejo de CORS pre-flight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        return res.end();
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    // --- API REST ---
    if (pathname.startsWith('/api/')) {
        try {
            // A. POST /api/auth/register
            if (pathname === '/api/auth/register' && req.method === 'POST') {
                const body = await leerJSONBody(req);
                const nombre = (body.nombre || '').trim();
                const usuario = (body.usuario || '').trim().toLowerCase();
                const password = (body.password || '').trim();

                if (!nombre || !usuario || !password || password.length < 6) {
                    return responderJSON(res, 400, { error: "Datos incompletos o contraseña menor a 6 caracteres." });
                }

                // Verificar si usuario existe
                const checkStmt = db.prepare(`SELECT id FROM coordinadores WHERE usuario = ?`);
                if (checkStmt.get(usuario)) {
                    return responderJSON(res, 409, { error: "El nombre de usuario ya está registrado." });
                }

                const salt = crypto.randomBytes(16).toString('hex');
                const passwordHash = hashPassword(password, salt);
                const nuevoId = "coord_" + Date.now() + "_" + crypto.randomBytes(4).toString('hex');

                const insertStmt = db.prepare(`
                    INSERT INTO coordinadores (id, nombre, usuario, password_hash, salt)
                    VALUES (?, ?, ?, ?, ?)
                `);
                insertStmt.run(nuevoId, nombre, usuario, passwordHash, salt);

                // Crear sesión
                const token = generarToken();
                db.prepare(`INSERT INTO sesiones (token, coordinador_id) VALUES (?, ?)`).run(token, nuevoId);

                return responderJSON(res, 201, {
                    success: true,
                    token: token,
                    usuario: { id: nuevoId, nombre: nombre, usuario: usuario }
                });
            }

            // B. POST /api/auth/login
            if (pathname === '/api/auth/login' && req.method === 'POST') {
                const body = await leerJSONBody(req);
                const usuario = (body.usuario || '').trim().toLowerCase();
                const password = (body.password || '').trim();

                if (!usuario || !password) {
                    return responderJSON(res, 400, { error: "Ingresa usuario y contraseña." });
                }

                const stmt = db.prepare(`SELECT id, nombre, usuario, password_hash, salt FROM coordinadores WHERE usuario = ?`);
                const coord = stmt.get(usuario);

                if (!coord) {
                    return responderJSON(res, 401, { error: "Usuario o contraseña incorrectos." });
                }

                const hashCalculado = hashPassword(password, coord.salt);
                if (hashCalculado !== coord.password_hash) {
                    return responderJSON(res, 401, { error: "Usuario o contraseña incorrectos." });
                }

                const token = generarToken();
                db.prepare(`INSERT INTO sesiones (token, coordinador_id) VALUES (?, ?)`).run(token, coord.id);

                return responderJSON(res, 200, {
                    success: true,
                    token: token,
                    usuario: { id: coord.id, nombre: coord.nombre, usuario: coord.usuario }
                });
            }

            // C. GET /api/auth/me
            if (pathname === '/api/auth/me' && req.method === 'GET') {
                const coord = autenticarRequest(req);
                if (!coord) return responderJSON(res, 401, { error: "No autorizado" });
                return responderJSON(res, 200, { success: true, usuario: coord });
            }

            // D. POST /api/auth/logout
            if (pathname === '/api/auth/logout' && req.method === 'POST') {
                const authHeader = req.headers['authorization'];
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    const token = authHeader.substring(7).trim();
                    db.prepare(`DELETE FROM sesiones WHERE token = ?`).run(token);
                }
                return responderJSON(res, 200, { success: true });
            }

            // E. GESTIÓN DE MESAS
            // GET /api/mesas
            if (pathname === '/api/mesas' && req.method === 'GET') {
                const coord = autenticarRequest(req);
                if (!coord) return responderJSON(res, 401, { error: "No autorizado" });

                const stmt = db.prepare(`
                    SELECT numero, local_votacion as localVotacion, distrito, aula 
                    FROM mesas 
                    WHERE coordinador_id = ? 
                    ORDER BY numero ASC
                `);
                const mesas = stmt.all(coord.id);
                return responderJSON(res, 200, { success: true, mesas });
            }

            // POST /api/mesas
            if (pathname === '/api/mesas' && req.method === 'POST') {
                const coord = autenticarRequest(req);
                if (!coord) return responderJSON(res, 401, { error: "No autorizado" });

                const body = await leerJSONBody(req);
                const numero = (body.numero || '').trim();
                const localVotacion = (body.localVotacion || '').trim();
                const distrito = (body.distrito || '').trim();
                const aula = (body.aula || '').trim();

                if (!/^\d{6}$/.test(numero)) {
                    return responderJSON(res, 400, { error: "El número de mesa debe tener exactamente 6 dígitos." });
                }

                try {
                    const id = "mesa_" + Date.now() + "_" + crypto.randomBytes(3).toString('hex');
                    db.prepare(`
                        INSERT INTO mesas (id, coordinador_id, numero, local_votacion, distrito, aula)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `).run(id, coord.id, numero, localVotacion, distrito, aula);

                    return responderJSON(res, 201, { success: true, mesa: { numero, localVotacion, distrito, aula } });
                } catch (err) {
                    if (err.message && err.message.includes("UNIQUE")) {
                        return responderJSON(res, 409, { error: `La mesa ${numero} ya está registrada en tu cuenta.` });
                    }
                    throw err;
                }
            }

            // DELETE /api/mesas/:numero
            if (pathname.startsWith('/api/mesas/') && req.method === 'DELETE') {
                const coord = autenticarRequest(req);
                if (!coord) return responderJSON(res, 401, { error: "No autorizado" });

                const numero = decodeURIComponent(pathname.split('/')[3] || '');
                if (!numero) return responderJSON(res, 400, { error: "Número de mesa no especificado." });

                db.prepare(`DELETE FROM mesas WHERE coordinador_id = ? AND numero = ?`).run(coord.id, numero);
                db.prepare(`DELETE FROM miembros WHERE coordinador_id = ? AND mesa = ?`).run(coord.id, numero);

                return responderJSON(res, 200, { success: true });
            }

            // F. GESTIÓN DE MIEMBROS
            // GET /api/miembros
            if (pathname === '/api/miembros' && req.method === 'GET') {
                const coord = autenticarRequest(req);
                if (!coord) return responderJSON(res, 401, { error: "No autorizado" });

                const stmt = db.prepare(`
                    SELECT 
                        id, mesa, cargo, nombre, dni, telefono, direccion,
                        vive_en_direccion = 1 as viveEnDireccion,
                        contactado = 1 as contactado,
                        credencial = 1 as credencial,
                        capacitacion = 1 as capacitacion,
                        capacitacion_1 = 1 as capacitacion1,
                        capacitacion_2 = 1 as capacitacion2,
                        asiste_elecciones as asisteElecciones,
                        visita_realizada = 1 as visitaRealizada,
                        visita_estado as visitaEstado,
                        visita_fecha as visitaFecha,
                        visita_observaciones as visitaObservaciones,
                        observaciones
                    FROM miembros 
                    WHERE coordinador_id = ?
                    ORDER BY mesa ASC, id ASC
                `);
                const rawMiembros = stmt.all(coord.id);
                const miembros = rawMiembros.map(m => ({
                    ...m,
                    viveEnDireccion: Boolean(m.viveEnDireccion),
                    contactado: Boolean(m.contactado),
                    credencial: Boolean(m.credencial),
                    capacitacion: Boolean(m.capacitacion || m.capacitacion1 || m.capacitacion2),
                    capacitacion1: Boolean(m.capacitacion1),
                    capacitacion2: Boolean(m.capacitacion2),
                    asisteElecciones: m.asisteElecciones || 'pendiente',
                    visitaRealizada: Boolean(m.visitaRealizada)
                }));
                return responderJSON(res, 200, { success: true, miembros });
            }

            // POST /api/miembros
            if (pathname === '/api/miembros' && req.method === 'POST') {
                const coord = autenticarRequest(req);
                if (!coord) return responderJSON(res, 401, { error: "No autorizado" });

                const b = await leerJSONBody(req);
                const id = "m_" + Date.now() + "_" + crypto.randomBytes(4).toString('hex');
                const cap1 = b.capacitacion1 ? 1 : 0;
                const cap2 = b.capacitacion2 ? 1 : 0;
                const capGeneral = (b.capacitacion || cap1 || cap2) ? 1 : 0;

                db.prepare(`
                    INSERT INTO miembros (
                        id, coordinador_id, mesa, cargo, nombre, dni, telefono, direccion,
                        vive_en_direccion, contactado, credencial, capacitacion,
                        capacitacion_1, capacitacion_2, asiste_elecciones,
                        visita_realizada, visita_estado, visita_fecha, visita_observaciones, observaciones
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    id, coord.id,
                    (b.mesa || '').trim(),
                    (b.cargo || '').trim(),
                    (b.nombre || '').trim(),
                    (b.dni || '').trim(),
                    (b.telefono || '').trim(),
                    (b.direccion || '').trim(),
                    b.viveEnDireccion ? 1 : 0,
                    b.contactado ? 1 : 0,
                    b.credencial ? 1 : 0,
                    capGeneral,
                    cap1,
                    cap2,
                    b.asisteElecciones || 'pendiente',
                    b.visitaRealizada ? 1 : 0,
                    b.visitaEstado || 'no_visitado',
                    b.visitaFecha || '',
                    b.visitaObservaciones || '',
                    b.observaciones || ''
                );

                return responderJSON(res, 201, { success: true, id });
            }

            // PUT /api/miembros/:id
            if (pathname.startsWith('/api/miembros/') && req.method === 'PUT') {
                const coord = autenticarRequest(req);
                if (!coord) return responderJSON(res, 401, { error: "No autorizado" });

                const id = decodeURIComponent(pathname.split('/')[3] || '');
                const b = await leerJSONBody(req);
                const cap1 = b.capacitacion1 ? 1 : 0;
                const cap2 = b.capacitacion2 ? 1 : 0;
                const capGeneral = (b.capacitacion || cap1 || cap2) ? 1 : 0;

                db.prepare(`
                    UPDATE miembros SET
                        mesa = ?,
                        cargo = ?,
                        nombre = ?,
                        dni = ?,
                        telefono = ?,
                        direccion = ?,
                        vive_en_direccion = ?,
                        contactado = ?,
                        credencial = ?,
                        capacitacion = ?,
                        capacitacion_1 = ?,
                        capacitacion_2 = ?,
                        asiste_elecciones = ?,
                        visita_realizada = ?,
                        visita_estado = ?,
                        visita_fecha = ?,
                        visita_observaciones = ?,
                        observaciones = ?,
                        updated_at = datetime('now')
                    WHERE id = ? AND coordinador_id = ?
                `).run(
                    (b.mesa || '').trim(),
                    (b.cargo || '').trim(),
                    (b.nombre || '').trim(),
                    (b.dni || '').trim(),
                    (b.telefono || '').trim(),
                    (b.direccion || '').trim(),
                    b.viveEnDireccion ? 1 : 0,
                    b.contactado ? 1 : 0,
                    b.credencial ? 1 : 0,
                    capGeneral,
                    cap1,
                    cap2,
                    b.asisteElecciones || 'pendiente',
                    b.visitaRealizada ? 1 : 0,
                    b.visitaEstado || 'no_visitado',
                    b.visitaFecha || '',
                    b.visitaObservaciones || '',
                    b.observaciones || '',
                    id, coord.id
                );

                return responderJSON(res, 200, { success: true });
            }

            // DELETE /api/miembros/:id
            if (pathname.startsWith('/api/miembros/') && req.method === 'DELETE') {
                const coord = autenticarRequest(req);
                if (!coord) return responderJSON(res, 401, { error: "No autorizado" });

                const id = decodeURIComponent(pathname.split('/')[3] || '');
                db.prepare(`DELETE FROM miembros WHERE id = ? AND coordinador_id = ?`).run(id, coord.id);

                return responderJSON(res, 200, { success: true });
            }

            // G. GET /api/backup (Descargar Respaldo JSON de la cuenta)
            if (pathname === '/api/backup' && req.method === 'GET') {
                const coord = autenticarRequest(req);
                if (!coord) return responderJSON(res, 401, { error: "No autorizado" });

                const mesas = db.prepare(`SELECT numero, local_votacion as localVotacion, distrito, aula FROM mesas WHERE coordinador_id = ?`).all(coord.id);
                const rawMiembros = db.prepare(`
                    SELECT id, mesa, cargo, nombre, dni, telefono, direccion, 
                           vive_en_direccion = 1 as viveEnDireccion,
                           contactado = 1 as contactado, credencial = 1 as credencial, capacitacion = 1 as capacitacion,
                           capacitacion_1 = 1 as capacitacion1,
                           capacitacion_2 = 1 as capacitacion2,
                           asiste_elecciones as asisteElecciones,
                           visita_realizada = 1 as visitaRealizada, visita_estado as visitaEstado,
                           visita_fecha as visitaFecha, visita_observaciones as visitaObservaciones, observaciones
                    FROM miembros WHERE coordinador_id = ?
                `).all(coord.id);

                const miembros = rawMiembros.map(m => ({
                    ...m,
                    viveEnDireccion: Boolean(m.viveEnDireccion),
                    contactado: Boolean(m.contactado),
                    credencial: Boolean(m.credencial),
                    capacitacion: Boolean(m.capacitacion || m.capacitacion1 || m.capacitacion2),
                    capacitacion1: Boolean(m.capacitacion1),
                    capacitacion2: Boolean(m.capacitacion2),
                    asisteElecciones: m.asisteElecciones || 'pendiente',
                    visitaRealizada: Boolean(m.visitaRealizada)
                }));

                return responderJSON(res, 200, {
                    coordinador: coord.nombre,
                    usuario: coord.usuario,
                    fechaRespaldo: new Date().toISOString(),
                    mesas,
                    miembros
                });
            }

            return responderJSON(res, 404, { error: "Endpoint no encontrado" });
        } catch (err) {
            console.error("Error en API:", err);
            return responderJSON(res, 500, { error: "Error interno del servidor", detalle: err.message });
        }
    }

    // --- SERVIR ARCHIVOS ESTÁTICOS DE LA SPA ---
    if (req.method === 'GET' || req.method === 'HEAD') {
        let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

        // Prevenir directory traversal
        if (!filePath.startsWith(PUBLIC_DIR)) {
            res.writeHead(403);
            return res.end("Prohibido");
        }

        // Si no existe el archivo solicitado, servir index.html (SPA Fallback)
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            filePath = path.join(PUBLIC_DIR, 'index.html');
        }

        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.ico': 'image/x-icon',
            '.svg': 'image/svg+xml'
        };

        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400'
        });

        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(filePath).pipe(res);
        return;
    }

    res.writeHead(405);
    res.end("Método no permitido");
});

// Iniciar servidor
server.listen(PORT, HOST, () => {
    console.log(`====================================================`);
    console.log(`🗳️  SISTEMA DE GESTIÓN ONPE 2026 - LIMA OESTE 1`);
    console.log(`🚀  Servidor activo en: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`📱  Acceso móvil: Disponible en toda tu red o nube`);
    console.log(`====================================================`);
});
