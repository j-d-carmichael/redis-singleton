// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 10000, // Increase timeout for potential Redis delays
};
