# Use the official Node.js 20 Alpine image for a small footprint
FROM node:20-alpine

# Set the working directory
WORKDIR /app

# Copy package files first to leverage Docker's cache
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of your backend source code
COPY . .

# Generate the Prisma client (Crucial for your DB handshake)
RUN npx prisma generate

# Build your TypeScript code
RUN npm run build

# The port your Express server runs on
EXPOSE 5001

# Command to run the app
CMD ["npm", "start"]
