# Usar imagen oficial de Node.js
FROM node:18-slim

# Crear directorio de trabajo
WORKDIR /app

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias
RUN npm install --production

# Copiar código fuente
COPY . .

# Crear directorio public para frontend
RUN mkdir -p public

# Exponer puerto 8080 (requerido por Cloud Run)
EXPOSE 8080

# Configurar variables de entorno
ENV NODE_ENV=production
ENV PORT=8080

# Comando para iniciar la aplicación
CMD ["npm", "start"]
