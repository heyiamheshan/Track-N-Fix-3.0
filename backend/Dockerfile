# Use Node 20 Alpine
FROM node:20-alpine

# Install OpenSSL 1.1 (Required for Prisma on Alpine)
RUN apk add --no-cache openssl

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build the project (if using TypeScript)
RUN npm run build

# Expose the port EB is expecting
EXPOSE 5001

# Start the application
CMD ["npm", "start"]