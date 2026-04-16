// Mock for expo-sqlite to prevent native module initialization errors in Jest
module.exports = {
  openDatabaseAsync: jest.fn().mockResolvedValue({
    execAsync: jest.fn(),
    runAsync: jest.fn(),
    getFirstAsync: jest.fn(),
    getAllAsync: jest.fn(),
    closeAsync: jest.fn(),
  }),
  SQLiteDatabase: class MockDatabase {
    async execAsync() {}
    async runAsync() {}
    async getFirstAsync() {}
    async getAllAsync() {}
    async closeAsync() {}
  },
}
