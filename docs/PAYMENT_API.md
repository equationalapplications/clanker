# Payment API Reference

Complete API documentation for the Clanker payment system.

## Base URLs

- **Transaction Manager**: `https://transactionmanager-[hash]-uc.a.run.app`
- **Stripe Webhook**: `https://stripewebhook-[hash]-uc.a.run.app`
- **Exchange Token**: `https://exchangetoken-[hash]-uc.a.run.app`

## Authentication

All API calls to the Transaction Manager require authentication. Include the Firebase ID token in the Authorization header:

```http
Authorization: Bearer <firebase-id-token>
```

## Transaction Manager API

### Create Transaction

Create a new transaction record.

**Endpoint**: `POST /?action=create`

**Request Body**:

```json
{
  "user_id": "string",
  "app_name": "string",
  "external_transaction_id": "string?",
  "provider": "stripe" | "google_play" | "apple_app_store",
  "provider_product_id": "string?",
  "transaction_type": "subscription" | "one_time" | "refund" | "chargeback",
  "amount_cents": "number",
  "currency": "string?",
  "provider_metadata": "object?",
  "internal_metadata": "object?"
}
```

**Response**:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "user_id": "uuid",
    "app_name": "string",
    "transaction_id": "string",
    "external_transaction_id": "string",
    "provider": "string",
    "transaction_type": "string",
    "amount_cents": "number",
    "currency": "string",
    "status": "pending",
    "created_at": "timestamp",
    "updated_at": "timestamp",
    "provider_metadata": "object",
    "internal_metadata": "object"
  }
}
```

**Example**:

```bash
curl -X POST 'https://transactionmanager-[hash]-uc.a.run.app/?action=create' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <firebase-token>' \
  -d '{
    "user_id": "123e4567-e89b-12d3-a456-426614174000",
    "app_name": "yours-brightly",
    "provider": "stripe",
    "transaction_type": "one_time",
    "amount_cents": 300,
    "currency": "USD",
    "external_transaction_id": "pi_stripe_payment_intent",
    "internal_metadata": {
      "credit_amount": 100,
      "product_name": "Credits (100)"
    }
  }'
```

### Update Transaction Status

Update the status of an existing transaction.

**Endpoint**: `PATCH /?action=update-status`

**Request Body**:

```json
{
  "transaction_id": "string",
  "status": "pending" | "completed" | "failed" | "refunded" | "disputed",
  "provider_metadata": "object?"
}
```

**Response**:

```json
{
  "success": true,
  "message": "Transaction status updated successfully"
}
```

### Get Transaction

Retrieve a specific transaction by ID.

**Endpoint**: `GET /?action=get&transaction_id={transaction_id}`

**Query Parameters**:

- `transaction_id` (required): The transaction ID to retrieve

**Response**:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "user_id": "uuid",
    "app_name": "string",
    "transaction_id": "string",
    "external_transaction_id": "string",
    "provider": "string",
    "transaction_type": "string",
    "amount_cents": "number",
    "currency": "string",
    "status": "string",
    "transaction_date": "timestamp",
    "created_at": "timestamp",
    "updated_at": "timestamp",
    "provider_metadata": "object",
    "internal_metadata": "object",
    "receipt_data": "object"
  }
}
```

### List User Transactions

Get transaction history for a user.

**Endpoint**: `GET /?action=list`

**Query Parameters**:

- `user_id` (required): User UUID
- `app_name` (optional): Filter by app name
- `limit` (optional): Number of results (default: 50, max: 100)
- `offset` (optional): Pagination offset (default: 0)

**Response**:

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "app_name": "string",
      "transaction_id": "string",
      "transaction_type": "string",
      "amount_cents": "number",
      "currency": "string",
      "status": "string",
      "created_at": "timestamp"
    }
  ]
}
```

**Example**:

```bash
curl 'https://transactionmanager-[hash]-uc.a.run.app/?action=list&user_id=123e4567-e89b-12d3-a456-426614174000&app_name=yours-brightly&limit=20&offset=0' \
  -H 'Authorization: Bearer <firebase-token>'
```

### Request Refund

Submit a refund request for a transaction.

**Endpoint**: `POST /?action=request-refund`

**Request Body**:

```json
{
  "transaction_id": "string",
  "refund_amount_cents": "number",
  "refund_reason": "string?",
  "refund_type": "full" | "partial" | "proration",
  "requested_by_user_id": "string?",
  "requested_by_admin_id": "string?"
}
```

**Response**:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "transaction_id": "string",
    "refund_amount_cents": "number",
    "refund_reason": "string",
    "refund_type": "string",
    "status": "requested",
    "requested_at": "timestamp",
    "requested_by_user_id": "string"
  }
}
```

### Update Refund Status

Update the status of a refund (admin only).

**Endpoint**: `PATCH /?action=update-refund`

**Request Body**:

```json
{
  "refund_id": "string",
  "status": "requested" | "processing" | "completed" | "failed" | "rejected",
  "provider_refund_id": "string?",
  "provider_response": "object?",
  "admin_notes": "string?"
}
```

**Response**:

```json
{
  "success": true,
  "message": "Refund status updated successfully"
}
```

### Generate Receipt

Generate receipt data for a transaction.

**Endpoint**: `POST /?action=generate-receipt`

**Request Body**:

```json
{
  "transaction_id": "string"
}
```

**Response**:

```json
{
  "success": true,
  "data": {
    "transaction_id": "string",
    "receipt_number": "string",
    "customer_email": "string",
    "customer_name": "string",
    "line_items": [
      {
        "description": "string",
        "quantity": "number",
        "unit_price_cents": "number",
        "total_price_cents": "number"
      }
    ],
    "subtotal_cents": "number",
    "tax_cents": "number",
    "total_cents": "number",
    "payment_method": "string",
    "issued_at": "timestamp"
  }
}
```

### Get Transaction Summary

Get aggregated transaction data with refund information.

**Endpoint**: `GET /?action=summary&transaction_id={transaction_id}`

**Response**:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "user_id": "uuid",
    "app_name": "string",
    "transaction_id": "string",
    "provider": "string",
    "transaction_type": "string",
    "amount_cents": "number",
    "currency": "string",
    "status": "string",
    "transaction_date": "timestamp",
    "total_refunded_cents": "number",
    "net_amount_cents": "number",
    "refund_count": "number"
  }
}
```

### Get Transaction Events

Retrieve audit trail events for transactions.

**Endpoint**: `GET /?action=events`

**Query Parameters**:

- `transaction_id` (optional): Filter by transaction ID
- `event_type` (optional): Filter by event type
- `limit` (optional): Number of results (default: 100)

**Response**:

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "transaction_id": "string",
      "event_type": "string",
      "event_source": "string",
      "event_data": "object",
      "raw_event_data": "object",
      "processed_at": "timestamp",
      "processing_status": "string",
      "error_message": "string"
    }
  ]
}
```

## Stripe Webhook Events

The Stripe webhook automatically processes the following events:

### Subscription Events

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

### Payment Intent Events

- `payment_intent.succeeded`
- `payment_intent.payment_failed`

### Webhook Payload Processing

When Stripe sends a webhook, the system:

1. **Validates** the webhook signature
2. **Processes** the event based on type
3. **Creates/Updates** subscription records
4. **Creates** transaction records
5. **Updates** user credits
6. **Logs** the event for audit trails
7. **Triggers** user token refresh

## Error Responses

All API endpoints return errors in this format:

```json
{
  "success": false,
  "error": "Error message description"
}
```

### Common Error Codes

| HTTP Status | Error Type     | Description                       |
| ----------- | -------------- | --------------------------------- |
| 400         | Bad Request    | Missing or invalid parameters     |
| 401         | Unauthorized   | Invalid or missing authentication |
| 403         | Forbidden      | Insufficient permissions          |
| 404         | Not Found      | Resource not found                |
| 409         | Conflict       | Resource already exists           |
| 500         | Internal Error | Server error                      |

### Example Error Response

```json
{
  "success": false,
  "error": "Missing required field: user_id"
}
```

## Rate Limiting

API endpoints are rate limited to prevent abuse:

- **Transaction creation**: 10 requests per minute per user
- **Transaction queries**: 100 requests per minute per user
- **Refund requests**: 5 requests per minute per user

Rate limit headers are included in responses:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1641234567
```

## Webhooks

### Stripe Webhook Configuration

Configure Stripe to send webhooks to:
`https://stripewebhook-[hash]-uc.a.run.app`

Required webhook events:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`

### Webhook Security

Webhooks are secured using:

- **Stripe signature verification** with webhook secret
- **Timestamp validation** to prevent replay attacks
- **Idempotency** to handle duplicate events

## SDKs and Libraries

### JavaScript/TypeScript

```typescript
// Transaction service helper
class TransactionService {
  private baseUrl = 'https://transactionmanager-[hash]-uc.a.run.app'

  async createTransaction(data: CreateTransactionRequest): Promise<Transaction> {
    const response = await fetch(`${this.baseUrl}/?action=create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await this.getAuthToken()}`,
      },
      body: JSON.stringify(data),
    })

    const result = await response.json()
    if (!result.success) throw new Error(result.error)
    return result.data
  }

  async getUserTransactions(
    userId: string,
    options?: {
      appName?: string
      limit?: number
      offset?: number
    },
  ): Promise<Transaction[]> {
    const params = new URLSearchParams({
      action: 'list',
      user_id: userId,
      ...(options?.appName && { app_name: options.appName }),
      ...(options?.limit && { limit: options.limit.toString() }),
      ...(options?.offset && { offset: options.offset.toString() }),
    })

    const response = await fetch(`${this.baseUrl}/?${params}`, {
      headers: {
        Authorization: `Bearer ${await this.getAuthToken()}`,
      },
    })

    const result = await response.json()
    if (!result.success) throw new Error(result.error)
    return result.data
  }

  private async getAuthToken(): Promise<string> {
    // Implement Firebase auth token retrieval
    throw new Error('Implement auth token retrieval')
  }
}
```

### React Hooks

```typescript
import { useQuery, useMutation } from '@tanstack/react-query'

// Get user transactions
export const useUserTransactions = (userId: string) => {
  return useQuery({
    queryKey: ['transactions', userId],
    queryFn: () => transactionService.getUserTransactions(userId),
  })
}

// Create transaction
export const useCreateTransaction = () => {
  return useMutation({
    mutationFn: transactionService.createTransaction,
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries(['transactions'])
      queryClient.invalidateQueries(['userCredits'])
    },
  })
}
```

### React Native Integration

```typescript
// Credit purchase flow
export const useCreditPurchase = () => {
  const { initPaymentSheet, presentPaymentSheet } = useStripe()
  const createTransaction = useCreateTransaction()

  return useMutation({
    mutationFn: async ({ creditAmount, priceId }: { creditAmount: number; priceId: string }) => {
      // 1. Create payment intent
      const paymentIntent = await createPaymentIntent({
        amount: creditAmount * 3, // $0.03 per credit
        metadata: { credit_amount: creditAmount },
      })

      // 2. Initialize payment sheet
      await initPaymentSheet({
        paymentIntentClientSecret: paymentIntent.client_secret,
      })

      // 3. Present payment sheet
      const result = await presentPaymentSheet()

      if (result.error) throw result.error

      // 4. Create transaction record
      return createTransaction.mutateAsync({
        user_id: userId,
        app_name: 'yours-brightly',
        provider: 'stripe',
        transaction_type: 'one_time',
        amount_cents: creditAmount * 3,
        external_transaction_id: paymentIntent.id,
        internal_metadata: { credit_amount: creditAmount },
      })
    },
  })
}
```

## Testing

### Test Environment

Use Stripe's test mode for development:

- **Test Publishable Key**: `pk_test_...`
- **Test Secret Key**: `sk_test_...`
- **Test Webhook Secret**: `whsec_test_...`

### Test Cards

| Card Number      | Description               |
| ---------------- | ------------------------- |
| 4242424242424242 | Visa (succeeds)           |
| 4000000000000002 | Visa (declined)           |
| 4000000000009995 | Visa (insufficient funds) |
| 4000000000000069 | Visa (expired)            |

### Testing Webhooks

Use Stripe CLI to test webhooks locally:

```bash
# Install Stripe CLI
npm install -g stripe-cli

# Login to Stripe
stripe login

# Forward webhooks to local endpoint
stripe listen --forward-to localhost:3000/webhook

# Trigger test events
stripe trigger payment_intent.succeeded
stripe trigger customer.subscription.created
```

### Test Transaction Flow

```bash
# Create test transaction
curl -X POST 'https://transactionmanager-[hash]-uc.a.run.app/?action=create' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <test-token>' \
  -d '{
    "user_id": "test-user-123",
    "app_name": "yours-brightly",
    "provider": "stripe",
    "transaction_type": "one_time",
    "amount_cents": 300,
    "external_transaction_id": "pi_test_123"
  }'

# Get transaction
curl 'https://transactionmanager-[hash]-uc.a.run.app/?action=get&transaction_id=txn_test_123' \
  -H 'Authorization: Bearer <test-token>'
```

---

This API reference provides complete documentation for integrating with the Clanker payment system. For additional support, refer to the main [Payment System Documentation](./PAYMENT_SYSTEM.md).

_Last updated: October 2, 2025_
