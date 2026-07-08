// ... same as provided file, but replace the insufficient credits error string

// In handlePlusPress, around the convertDocumentText error handling:
          } else if (
            firebaseCode === 'functions/failed-precondition' &&
            typeof message === 'string' &&
            message.toLowerCase().includes('insufficient credits')
          ) {
            setToastMessage('Out of Power — recharge to keep chatting.')
          }

// The rest of the file remains unchanged.
