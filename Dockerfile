# Use the optimized node-caged image, which requires using Corepack
FROM platformatic/node-caged:slim

# Install bun via corepack (or npm if corepack approach isn't directly supported by this specific image variant, but the caged docs say it supports node workflows)
# Since the app uses Bun, and this is a node image, we can just install bun globally.
USER root
RUN npm install -g bun

# Set working directory
WORKDIR /app

# Copy package and lock files
COPY package.json bun.lock ./

# Install dependencies using bun
RUN bun install --production

# Copy application files
COPY . .

# Environment variable for port
ENV PORT=44253

# Expose the configured port
EXPOSE 44253

# Run the application using the optimized production command
CMD ["bun", "run", "start"]