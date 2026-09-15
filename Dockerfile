# Imagen oficial ligera de Node 24 con soporte nativo de SQLite
FROM node:24-alpine

WORKDIR /app

# Copiar archivos de dependencias y aplicación
COPY package*.json ./
COPY . .

# Variables de entorno
ENV PORT=3000
ENV NODE_ENV=production

# Puerto expuesto
EXPOSE 3000

# Comando de inicio del servidor centralizado
CMD ["node", "server.js"]
