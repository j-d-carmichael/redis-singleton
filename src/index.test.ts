import {
  connect,
  disconnect,
  getClient,
  EnhancedRedisClient
} from './index';
import { createClient } from 'redis';

// --- Configuration ---
const TEST_DB = 0; // Use database 0 as requested
const TEST_REDIS_URL = `redis://localhost:6379/${TEST_DB}`;
// Helper function to clear the database between tests
const flushTestDB = async () => {
  const cleanupClient = createClient({ url: TEST_REDIS_URL });
  await cleanupClient.connect();
  await cleanupClient.flushDb();
  await cleanupClient.disconnect();
};

// --- Test Suite ---
describe('Redis Client Module', () => {
  // Ensure DB is clean before any test runs
  beforeAll(async () => {
    await flushTestDB();
  });

  // Disconnect and clean up after each test to ensure isolation
  afterEach(async () => {
    try {
      await disconnect(); // Disconnect the module's singleton client
    } catch (error) {
      // Ignore errors if already disconnected etc.
    }
    await flushTestDB(); // Clean the DB contents
  });

  describe('Connection Logic', () => {
    it('should throw an error when getting client before connecting', () => {
      expect(() => getClient()).toThrow('Redis client is not connected. Call connect() first.');
    });

    it('should connect successfully using options object', async () => {
      await expect(connect({ database: TEST_DB })).resolves.toBeUndefined();
      const client = getClient();
      expect(client).toBeDefined();
      expect(client.isOpen).toBe(true);
    });

    it('should connect successfully using URL string', async () => {
      await expect(connect(TEST_REDIS_URL)).resolves.toBeUndefined();
      const client = getClient();
      expect(client).toBeDefined();
      expect(client.isOpen).toBe(true);
    });

    it('should return the same client instance (singleton)', async () => {
      await connect({ database: TEST_DB });
      const client1 = getClient();
      const client2 = getClient();
      expect(client1).toBe(client2);
    });

    it('should resolve immediately if connect is called when already connected', async () => {
      await connect({ database: TEST_DB });
      const startTime = Date.now();
      await connect({ database: TEST_DB }); // Call connect again
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(50); // Should be very fast
      const client = getClient();
      expect(client.isOpen).toBe(true);
    });

    it('should resolve pending connection promise if connect is called while connecting', async () => {
      const p1 = connect({ database: TEST_DB });
      const p2 = connect({ database: TEST_DB }); // Call while p1 is potentially in progress

      await expect(Promise.all([p1, p2])).resolves.toEqual([undefined, undefined]);

      const client1 = getClient();
      const client2 = getClient();
      expect(client1).toBe(client2); // Should still be the same instance
      expect(client1.isOpen).toBe(true);
    });

    // Cannot easily test connection *failure* without mocking createClient or having a guaranteed non-existent redis
    // it('should throw error from getClient if connection failed', async () => { ... });
  });

  describe('Disconnection Logic', () => {
    it('should disconnect successfully', async () => {
      await connect({ database: TEST_DB });
      let client = getClient();
      expect(client.isOpen).toBe(true);

      await expect(disconnect()).resolves.toBeUndefined();

      // Check internal state (client should be null) via getClient behavior
      expect(() => getClient()).toThrow('Redis client is not connected.'); // Or potentially 'Redis connection closed.' depending on timing

      // Verify cannot use the old client reference
      await expect(client.ping()).rejects.toThrow(); // Throws something like "The client is closed"
    });

    it('should handle disconnect call when not connected', async () => {
      // Ensure not connected
      expect(() => getClient()).toThrow();
      await expect(disconnect()).resolves.toBeUndefined(); // Should not throw
    });

    it('should throw an error from getClient after disconnection', async () => {
      await connect({ database: TEST_DB });
      await disconnect();
      // The exact error message might vary slightly based on timing and error handling
      expect(() => getClient()).toThrow(/Redis connection unavailable: Redis connection closed.|Redis client is not connected./);
    });
  });

  describe('Enhanced Methods (setJson / getJson)', () => {
    let client: EnhancedRedisClient;

    // Connect before tests in this block
    beforeEach(async () => {
      await connect({ database: TEST_DB });
      client = getClient();
    });

    it('should return an enhanced client with setJson and getJson methods', () => {
      expect(client.setJson).toBeInstanceOf(Function);
      expect(client.getJson).toBeInstanceOf(Function);
    });

    it('should set and get a simple JSON object', async () => {
      const key = 'test:user:1';
      const data = { name: 'Alice', age: 30, active: true };
      const setResult = await client.setJson(key, data);
      expect(setResult).toBe('OK');

      const retrievedData = await client.getJson(key);
      expect(retrievedData).toEqual(data);
    });

    it('should set and get a JSON array', async () => {
      const key = 'test:items';
      const data = [1, 'test', null, { nested: true }];
      await client.setJson(key, data);
      const retrievedData = await client.getJson(key);
      expect(retrievedData).toEqual(data);
    });

    it('should set and get a string value', async () => {
      const key = 'test:string';
      const data = "Hello World";
      // Note: Storing a plain string via setJson will wrap it in JSON quotes
      await client.setJson(key, data);
      const retrievedData = await client.getJson(key);
      expect(retrievedData).toEqual(data); // JSON.parse('"Hello World"') -> "Hello World"
    });

    it('should set and get a number value', async () => {
      const key = 'test:number';
      const data = 123.45;
      await client.setJson(key, data);
      const retrievedData = await client.getJson(key);
      expect(retrievedData).toEqual(data);
    });

    it('should set and get a boolean value', async () => {
      const key = 'test:boolean:true';
      const data = true;
      await client.setJson(key, data);
      const retrievedData = await client.getJson(key);
      expect(retrievedData).toEqual(data);

      const keyFalse = 'test:boolean:false';
      const dataFalse = false;
      await client.setJson(keyFalse, dataFalse);
      const retrievedDataFalse = await client.getJson(keyFalse);
      expect(retrievedDataFalse).toEqual(dataFalse);
    });

    it('should set and get a null value', async () => {
      const key = 'test:null';
      const data = null;
      await client.setJson(key, data);
      const retrievedData = await client.getJson(key);
      expect(retrievedData).toBeNull();
    });

    it('should return null from getJson for a non-existent key', async () => {
      const retrievedData = await client.getJson('non:existent:key');
      expect(retrievedData).toBeNull();
    });

    it('should return null from getJson for a key with invalid JSON data', async () => {
      const key = 'test:invalid:json';
      // Use the base client's 'set' to store non-JSON directly
      await client.set(key, '{ invalid json data');

      // Mock console.error to check if it's called (optional but good)
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const retrievedData = await client.getJson(key);
      expect(retrievedData).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Error parsing JSON for key "${key}"`),
        expect.any(Error) // Or expect.any(SyntaxError)
      );

      consoleSpy.mockRestore(); // Clean up the spy
    });

    it('should set JSON with expiry and return null after expiry', async () => {
      const key = 'test:expiry';
      const data = { message: 'This will expire' };
      await client.setJson(key, data, { EX: 1 }); // Expire in 1 second

      // Check immediately
      let retrievedData = await client.getJson(key);
      expect(retrievedData).toEqual(data);

      // Wait for expiry (add a small buffer)
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Check after expiry
      retrievedData = await client.getJson(key);
      expect(retrievedData).toBeNull();
    });

    it('setJson should propagate errors from the underlying set command', async () => {
      // Simulate an error condition by disconnecting the client *after* getting it
      await disconnect();

      // Now try to use the (stale) client reference
      const key = 'test:error:set';
      const data = { test: 'wont work' };

      // We expect the underlying 'client.set' to throw because the client is closed
      await expect(client.setJson(key, data))
        .rejects
        .toThrow(/client is closed/i); // Error message might vary slightly
    });

    it('getJson should propagate errors from the underlying get command', async () => {
      // Simulate an error condition by disconnecting the client *after* getting it
      await disconnect();

      const key = 'test:error:get';

      // We expect the underlying 'client.get' to throw because the client is closed
      await expect(client.getJson(key))
        .rejects
        .toThrow(/client is closed/i); // Error message might vary slightly
    });

  });
});
