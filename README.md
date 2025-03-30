# Redis Singleton Manager

[![npm version](https://badge.fury.io/js/your-package-name.svg)](https://badge.fury.io/js/your-package-name) <!-- Replace your-package-name -->

A simple utility library to manage a singleton connection to a Redis server using the [`redis`](https://github.com/redis/node-redis) library (v4+). It ensures only one connection is established and provides easy access to the client instance.

## Features

*   **Singleton Connection:** Ensures only one Redis connection instance is active application-wide.
*   **Promise-Based:** Provides asynchronous `connect` and `disconnect` functions.
*   **Connection Management:** Handles concurrent connection attempts gracefully.
*   **State Tracking:** Keeps track of connection status (connecting, connected, error, disconnected).
*   **Enhanced Client:** The client returned by `getClient()` includes built-in `getJson` and `setJson` methods for easy storage and retrieval of JavaScript objects.
*   **TypeScript Support:** Written in TypeScript with type definitions included.

## Installation

```bash
npm install redis-singleton
```

### Note: 
This package requires redis (version 4 or higher) as a peer dependency. You need to install it alongside this package.

## Core Concepts
This library maintains a single, shared Redis client instance.

- You first connect() to establish the connection. Subsequent calls to connect() while already connected or connecting will return the existing connection promise or resolve immediately. 
- Once connected, you use getClient() to retrieve the active client instance for executing Redis commands. 
- When your application shuts down, you can call disconnect() to gracefully close the connection.

## Usage
### 1. Connecting to Redis
Import the connect function and call it with your Redis connection options or a Redis URL string. It returns a promise that resolves when the connection is ready. It's best practice to call this early in your application's startup sequence.

```typescript
// src/redis-init.ts (or similar startup file)
import { connect } from 'your-package-name'; // Replace your-package-name

let isRedisConnected = false;

export async function initializeRedis() {
  if (isRedisConnected) {
    console.log('Redis already initialized.');
    return;
  }

  try {
    console.log('Attempting to connect to Redis...');

    // Option 1: Using a connection URL string
    // await connect('redis://username:password@host:port/db');

    // Option 2: Using RedisClientOptions object
    await connect({
      socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        // connectTimeout: 5000, // Optional: Connection timeout
      },
      // password: process.env.REDIS_PASSWORD, // Optional
      // database: parseInt(process.env.REDIS_DB || '0', 10), // Optional
    });

    console.log('Successfully connected to Redis.');
    isRedisConnected = true;
    // Now you can use getClient() elsewhere in your app
  } catch (error) {
    console.error('FATAL: Failed to connect to Redis during initialization:', error);
    // Consider exiting the application if Redis is critical
    process.exit(1);
  }
}

// Call this early in your application startup process
// e.g., in your main server file (index.ts, server.ts, app.ts)
// await initializeRedis();
```


- connect() is idempotent. If called when already connected, it resolves immediately.
- If called while a connection attempt is already in progress, it returns the promise associated with that attempt, preventing multiple connection races.

### 2. Getting the Redis Client
Import the getClient function. Call it after you are sure the connect() promise has successfully resolved (usually after your initialization step).

```typescript
// src/services/my-service.ts
import { getClient } from 'your-package-name'; // Replace your-package-name
import { RedisClientType } from 'redis'; // Optional: for explicit typing

// Assume initializeRedis() from the previous step has been called and awaited successfully.

async function performRedisOperation(userId: string, data: string): Promise<void> {
  try {
    const redisClient: RedisClientType = getClient(); // Type assertion optional

    // Now use the client instance like any other node-redis client
    const key = `user:${userId}:data`;
    await redisClient.set(key, data, {
      // Optional arguments like EX (expire time in seconds)
      // EX: 3600 // Expires in 1 hour
    });
    console.log(`Data set for user ${userId}`);

    const retrievedValue = await redisClient.get(key);
    console.log(`Retrieved value for user ${userId}:`, retrievedValue);

  } catch (error) {
    console.error(`Redis operation failed for user ${userId}:`, error);
    // This catch block handles:
    // 1. Errors from getClient() if somehow called before connection.
    // 2. Errors from the Redis command itself (e.g., connection lost later, command syntax error).
    // Consider specific error handling or re-throwing based on your needs.
    throw new Error(`Failed to perform Redis operation: ${error.message}`);
  }
}

// Example usage within your application logic
// await performRedisOperation('user123', 'some important data');
```

- Important: getClient() will throw an error if:
  - connect() has not been called or hasn't successfully completed yet.
  - The client is currently attempting to connect.
  - A connection error occurred previously and wasn't resolved.
  - The client has been explicitly disconnected via disconnect().
- Always ensure your application flow guarantees connect() completes successfully before modules needing Redis access call getClient(). Using an initialization pattern (like initializeRedis above) is highly recommended.

### 3. Disconnecting from Redis
Import the disconnect function. Call it to gracefully close the connection, typically during your application's shutdown sequence to ensure pending commands are processed and resources are released cleanly.

```typescript
// src/server.ts (or your main application file)
import { disconnect } from 'your-package-name'; // Replace your-package-name
import { initializeRedis } from './redis-init';
// ... other imports (e.g., Express, http server)

async function startServer() {
  // ... setup http server, database connections etc ...

  await initializeRedis(); // Ensure Redis connects on startup

  // ... start listening for requests ...
  const server = httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });

  // Graceful shutdown logic
  const signals = ['SIGINT', 'SIGTERM'];
  signals.forEach(signal => {
    process.on(signal, async () => {
      console.log(`\nReceived ${signal}. Starting graceful shutdown...`);
      try {
        // 1. Stop accepting new connections
        server.close(async (err) => {
           if (err) {
             console.error('Error closing HTTP server:', err);
           } else {
             console.log('HTTP server closed.');
           }

           // 2. Disconnect from Redis
           console.log('Disconnecting from Redis...');
           await disconnect(); // Await the disconnection

           // 3. Disconnect from other resources (e.g., database)
           // await closeDatabaseConnection();

           console.log('Graceful shutdown complete.');
           process.exit(err ? 1 : 0);
        });

        // Force close server after a timeout if graceful shutdown fails
        setTimeout(() => {
          console.error('Graceful shutdown timed out. Forcing exit.');
          process.exit(1);
        }, 10000); // 10 second timeout

      } catch (shutdownError) {
        console.error('Error during graceful shutdown:', shutdownError);
        process.exit(1);
      }
    });
  });
}

startServer();
```
- disconnect() returns a promise that resolves when the disconnection is complete or if the client was already disconnected.
- It rejects if an error occurs during the underlying client.quit() attempt.

## API Reference
`connect(options?: RedisClientOptions | string): Promise<void>`
- **Description**: Establishes a singleton connection to the Redis server. If already connected or connecting, it returns the existing promise or resolves immediately. Handles underlying redis client creation and connection logic.
- **Parameters**:
  - `options (optional): Either a redis v4 RedisClientOptions object (imported from redis) or a Redis connection URL string (redis[s]://[[username][:password]@][host][:port][/db-number]). If omitted, redis defaults usually apply (e.g., connect to redis://localhost:6379).`
- **Returns**:
  - Promise<void> - Resolves when the connection is successfully established and the client is ready for commands. Rejects if the initial connection attempt fails.

`getClient(): RedisClientType<RedisModules, RedisFunctions, RedisScripts>`
- **Description**: Retrieves the active and connected Redis client instance managed by the singleton.
- **Parameters**: None.
- **Returns**: RedisClientType - The connected node-redis client instance. The specific type RedisClientType<RedisModules, RedisFunctions, RedisScripts> is the default client type from redis v4.
- **Throws:**
  - `Error('Redis client is not connected. Call connect() first.') - If connect was never called or did not succeed previously.`
  - `Error('Redis client is currently connecting. Use \await connect()` or ensure the connection promise resolves before calling getClient.')- Ifconnect` was called but the connection process is still ongoing.`
  - `Error('Redis connection unavailable: <original error message>') - If a previous connection attempt failed, or an operational error (like a disconnection) occurred that wasn't automatically resolved by the underlying client's reconnect logic.`

`disconnect(): Promise<void>`
- **Description:** Disconnects the singleton Redis client gracefully using client.quit(). If the client is not connected or already disconnected, it resolves immediately without error. Resets the internal state.
- **Parameters:** None.
- Returns: Promise<void> - Resolves upon successful disconnection or if already disconnected. Rejects if an error occurs during the client.quit() operation.

Promise<void> - Resolves upon successful disconnection or if already disconnected. Rejects if an error occurs during the client.quit() operation.

