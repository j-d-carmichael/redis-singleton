import {
  createClient,
  RedisClientOptions,
  RedisClientType,
  RedisFunctions,
  RedisModules,
  RedisScripts,
  SetOptions
} from 'redis';

// Define the base type for the Redis client
type DefaultRedisClient = RedisClientType<RedisModules, RedisFunctions, RedisScripts>;

// ----- Define the Enhanced Client Type -----
// This interface extends the base client type and adds our custom methods.
// JSON encode decode is a lot of duplication..
export interface EnhancedRedisClient extends DefaultRedisClient {
  /**
   * Stores a JavaScript object or value as a JSON string in Redis.
   * Throws an error if the client is not connected or if the `set` operation fails.
   *
   * @param key - The Redis key.
   * @param objectToStore - The JavaScript object/value to serialize and store.
   * @param options - Optional: Redis SET command options (e.g., { EX: 3600 } for expiry).
   * @returns A promise that resolves when the object is successfully stored (returns the result of the underlying SET command, usually 'OK').
   */
  setJson (key: string, objectToStore: any, options?: SetOptions): Promise<string | null>; // SET typically returns string | null

  /**
   * Retrieves a JSON string from Redis and parses it into a JavaScript object.
   * Returns null if the key does not exist.
   * Throws an error if the client is not connected or if the `get` operation fails.
   * Logs an error and returns null if the stored value is not valid JSON.
   *
   * @param key - The Redis key.
   * @returns A promise that resolves with the parsed JavaScript object, or null if not found or invalid JSON.
   */
  getJson (key: string): Promise<any | null>;
}

// Module-level state - Use the Enhanced type
let client: EnhancedRedisClient | null = null;
let connectionPromise: Promise<void> | null = null;
let connectionError: Error | null = null;

// --- Implementation for the custom methods ---
// We define these separately for clarity. They will be bound to the client instance.

async function setJsonImpl (
  this: EnhancedRedisClient, // `this` will be the client instance
  key: string,
  objectToStore: any,
  options?: SetOptions
): Promise<string | null> {
  try {
    const jsonString = JSON.stringify(objectToStore);
    // Call the original 'set' method on the client instance ('this')
    return await this.set(key, jsonString, options);
  } catch (error) {
    console.error(`Error setting JSON for key "${key}":`, error);
    throw error; // Re-throw the error
  }
}

async function getJsonImpl (
  this: EnhancedRedisClient, // `this` will be the client instance
  key: string
): Promise<any | null> {
  // Call the original 'get' method on the client instance ('this')
  const jsonString = await this.get(key);

  if (jsonString === null) {
    return null; // Key doesn't exist
  }

  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.error(`Error parsing JSON for key "${key}": Invalid JSON data stored in Redis.`, error);
    return null; // Return null on parse error
  }
}

/**
 * Connects to the Redis server using the provided options or URL string.
 * Returns a promise that resolves when the connection is established.
 * Manages a singleton connection state.
 *
 * @param options - Redis connection options object (RedisClientOptions) or a Redis URL string.
 * @returns A promise that resolves on successful connection, rejects on error.
 */
export function connect (
  options?: RedisClientOptions | string
): Promise<void> {
  if (client?.isOpen) {
    return Promise.resolve();
  }
  if (connectionPromise) {
    return connectionPromise;
  }

  connectionError = null;

  let redisOptions: RedisClientOptions | undefined;
  if (typeof options === 'string') {
    redisOptions = { url: options };
  } else {
    redisOptions = options;
  }

  // Create the *base* client instance first
  const baseClient = createClient(redisOptions);

  let resolveOuterPromise: () => void;
  let rejectOuterPromise: (reason?: any) => void;

  connectionPromise = new Promise<void>((resolve, reject) => {
    resolveOuterPromise = resolve;
    rejectOuterPromise = reject;

    baseClient.on('error', (err: Error) => {
      console.error('Redis Client Error:', err);
      connectionError = err;
      client = null; // Reset the enhanced client reference
    });

    baseClient.on('connect', () => { /* console.log('Redis client connecting...'); */ });
    baseClient.on('ready', () => { /* console.log('Redis client ready.'); */ });

    baseClient.on('end', () => {
      // console.log('Redis client connection ended.');
      const wasConnected = !!client;
      client = null; // Reset the enhanced client reference
      if (connectionPromise === promiseInstanceBeingReturned) {
        connectionPromise = null;
      }
      // Only set connection closed error if we were previously connected
      // and no other error caused the end.
      if (wasConnected && !connectionError) {
        connectionError = new Error('Redis connection closed.');
      }
    });

    baseClient.connect()
      .then(() => {
        // --- Success ---
        // Cast the connected base client to our enhanced type
        const enhancedClient = baseClient as unknown as EnhancedRedisClient;

        // *** Add the custom methods directly to the instance ***
        enhancedClient.setJson = setJsonImpl; // Methods are already bound implicitly when assigned like this if they use `this`
        enhancedClient.getJson = getJsonImpl;

        // Assign the now-enhanced client to the module scope
        client = enhancedClient;
        connectionError = null;
        resolveOuterPromise();
      })
      .catch((err) => {
        // --- Failure ---
        console.error('Redis connection failed:', err);
        client = null;
        connectionError = err instanceof Error ? err : new Error(String(err));
        rejectOuterPromise(connectionError);
      });
  });

  const promiseInstanceBeingReturned = connectionPromise;

  promiseInstanceBeingReturned.finally(() => {
    if (connectionPromise === promiseInstanceBeingReturned) {
      connectionPromise = null;
    }
  });

  return promiseInstanceBeingReturned;
}

/**
 * Retrieves the connected and enhanced Redis client instance.
 * The returned client includes standard redis commands plus `getJson` and `setJson`.
 * Throws an error if the client is not connected, is currently connecting,
 * or if the connection previously failed or closed.
 *
 * @returns The connected EnhancedRedisClient instance.
 * @throws {Error} If the client is not ready for use.
 */
export function getClient (): EnhancedRedisClient { // Return the Enhanced type
  if (client?.isOpen) {
    // Type assertion is safe here because we assign the enhanced client on connect
    return client;
  }

  if (connectionError) {
    throw new Error(`Redis connection unavailable: ${connectionError.message}`);
  }

  if (connectionPromise) {
    throw new Error('Redis client is currently connecting. Use `await connect()` or ensure the connection promise resolves before calling getClient.');
  }

  throw new Error('Redis client is not connected. Call connect() first.');
}

/**
 * Disconnects the Redis client gracefully if it is connected.
 * Returns a promise that resolves when disconnection is complete or if already disconnected.
 * Rejects if an error occurs during the disconnection attempt.
 * Also clears any pending connection promise.
 *
 * @returns A promise that resolves on successful disconnection or if already disconnected.
 */
export async function disconnect (): Promise<void> {
  // Use the module-level 'client' which is potentially EnhancedRedisClient | null
  const currentClient = client;

  connectionPromise = null; // Clear pending connection attempts

  if (currentClient?.isOpen) {
    try {
      // Quit will work fine on the enhanced client as it inherits the base methods
      await currentClient.quit();
    } catch (err) {
      console.error('Error during Redis disconnection:', err);
      connectionError = err instanceof Error ? err : new Error(String(err));
      client = null; // Ensure client is reset on error too
      throw connectionError; // Rethrow
    } finally {
      client = null; // Always reset client state after attempting quit
      // Clear error only if disconnect didn't cause it
      if (!(connectionError instanceof Error && connectionError.message.includes('disconnection'))) {
        connectionError = null;
      }
    }
  } else {
    // Ensure state is clean even if no active client was found
    client = null;
    connectionError = null;
  }
}
