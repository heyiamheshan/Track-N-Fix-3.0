# Use Node.js 20 Alpine
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Accept build-time API URL (NEXT_PUBLIC_ vars are baked in at build time)
ARG NEXT_PUBLIC_API_URL=http://localhost:5001/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Build the Next.js application
RUN npm run build

# Next.js runs on 3000 by default
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
