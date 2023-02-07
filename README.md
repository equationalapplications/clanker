# Yours Brightly AI  

Copyright Equational Applications LLC

## Firestore Data  

Collection: users_public
    Document: uid
        displayName: string
        avatar: string
        email: string

Collection: users_private
    Document: uid // private data by uid
        coins: number

Collection: bots
    Document: uid // private data by uid
        Collection: user_bots
            Document: uid // a generated id
                displayName: string
                avatar: string


Collection: chat_rooms
    Document: solo_chat_room
        Collection: user
            Document: uid // private data by uid
                Collection: messages
                    Document: id // a generated id
                    text: string

    Document: public_chat_room
        Collection: messages
            Document: id // a generated id
                sender: user || bot
                recepient: user || bot
                message: string
                date: string