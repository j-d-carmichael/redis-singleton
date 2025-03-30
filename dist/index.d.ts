import { RedisClientOptions, RedisClientType, RedisFunctions, RedisModules, RedisScripts, SetOptions } from 'redis';
type DefaultRedisClient = RedisClientType<RedisModules, RedisFunctions, RedisScripts>;
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
    setJson(key: string, objectToStore: any, options?: SetOptions): Promise<string | null>;
    /**
     * Retrieves a JSON string from Redis and parses it into a JavaScript object.
     * Returns null if the key does not exist.
     * Throws an error if the client is not connected or if the `get` operation fails.
     * Logs an error and returns null if the stored value is not valid JSON.
     *
     * @param key - The Redis key.
     * @returns A promise that resolves with the parsed JavaScript object, or null if not found or invalid JSON.
     */
    getJson(key: string): Promise<any | null>;
}
/**
 * Connects to the Redis server using the provided options or URL string.
 * Returns a promise that resolves when the connection is established.
 * Manages a singleton connection state.
 *
 * @param options - Redis connection options object (RedisClientOptions) or a Redis URL string.
 * @returns A promise that resolves on successful connection, rejects on error.
 */
export declare function connect(options?: RedisClientOptions | string): Promise<void>;
/**
 * Retrieves the connected and enhanced Redis client instance.
 * The returned client includes standard redis commands plus `getJson` and `setJson`.
 * Throws an error if the client is not connected, is currently connecting,
 * or if the connection previously failed or closed.
 *
 * @returns The connected EnhancedRedisClient instance.
 * @throws {Error} If the client is not ready for use.
 */
export declare function getClient(): EnhancedRedisClient;
/**
 * Disconnects the Redis client gracefully if it is connected.
 * Returns a promise that resolves when disconnection is complete or if already disconnected.
 * Rejects if an error occurs during the disconnection attempt.
 * Also clears any pending connection promise.
 *
 * @returns A promise that resolves on successful disconnection or if already disconnected.
 */
export declare function disconnect(): Promise<void>;
export {};
