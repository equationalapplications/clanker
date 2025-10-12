const authMock = {
  onAuthStateChanged: jest.fn(() => jest.fn()),
  currentUser: null,
}

const functionsMock = {
  httpsCallable: jest.fn(),
}

export { authMock, functionsMock }
