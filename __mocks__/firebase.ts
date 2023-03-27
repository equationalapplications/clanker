const authMock = {
  onAuthStateChanged: jest.fn(() => jest.fn()),
  currentUser: null,
}

const firestoreMock = {
  collection: jest.fn().mockReturnThis(),
  doc: jest.fn().mockReturnThis(),
  add: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  onSnapshot: jest.fn(),
}

const functionsMock = {
  httpsCallable: jest.fn(),
}

export { authMock, firestoreMock, functionsMock }
