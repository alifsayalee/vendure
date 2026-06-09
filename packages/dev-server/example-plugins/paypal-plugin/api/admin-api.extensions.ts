import gql from 'graphql-tag';

export const adminApiExtensions = gql`
    type PayPalBillingPlan {
        planId: String!
        name: String!
        status: String!
    }

    type PayPalSubscription {
        id: ID!
        paypalSubscriptionId: String!
        paypalPlanId: String!
        status: String!
        approvalUrl: String
        customerId: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
    }

    input CreatePayPalBillingPlanInput {
        """PayPal product ID — create one in the PayPal dashboard before calling this."""
        productId: String!
        name: String!
        description: String
        """Recurring price as a decimal string, e.g. \\"9.99\\"."""
        price: String!
        """ISO-4217 currency code, e.g. \\"USD\\"."""
        currencyCode: String!
        """Billing interval: DAY, WEEK, MONTH, or YEAR."""
        intervalUnit: String!
        """Number of interval units between charges, e.g. 1 for monthly."""
        intervalCount: Int!
        """Total billing cycles before the plan ends. 0 means infinite (default)."""
        totalCycles: Int
    }

    # ── UC7 — Transaction Reporting ─────────────────────────────────────────

    """A monetary amount as returned by PayPal (decimal string + ISO currency code)."""
    type PayPalMoney {
        value: String!
        currencyCode: String!
    }

    """A single transaction row from PayPal's Transaction Search API."""
    type PayPalTransaction {
        transactionId: String
        transactionEventCode: String
        transactionInitiationDate: String
        transactionUpdatedDate: String
        transactionAmount: PayPalMoney
        feeAmount: PayPalMoney
        transactionStatus: String
        transactionSubject: String
        invoiceId: String
        customField: String
        payerEmail: String
        payerName: String
    }

    """Paginated result of a PayPal transaction search."""
    type PayPalTransactionSearchResult {
        transactions: [PayPalTransaction!]!
        totalItems: Int!
        totalPages: Int!
        page: Int!
    }

    """A currency balance from the PayPal account."""
    type PayPalBalance {
        currency: String!
        primary: Boolean
        totalBalance: PayPalMoney!
        availableBalance: PayPalMoney
        withheldBalance: PayPalMoney
    }

    input PayPalTransactionSearchInput {
        """Start of the search window (RFC 3339, e.g. \\"2024-01-01T00:00:00Z\\"). Max range: 31 days."""
        startDate: String!
        """End of the search window (RFC 3339). Max range: 31 days."""
        endDate: String!
        transactionId: String
        """D=Denied, P=Pending, S=Success, V=Reversed"""
        transactionStatus: String
        """ISO-4217 currency code filter, e.g. \\"USD\\"."""
        transactionCurrency: String
        """Number of results per page (max 500, default 100)."""
        pageSize: Int
        """1-based page number (default 1)."""
        page: Int
    }

    extend type Query {
        """List all PayPal subscriptions stored in Vendure."""
        paypalSubscriptions: [PayPalSubscription!]!

        """UC7 — Search PayPal transactions by date range and optional filters."""
        paypalTransactions(input: PayPalTransactionSearchInput!): PayPalTransactionSearchResult!

        """UC7 — Fetch current PayPal account balances."""
        paypalBalances(asOfTime: String, currencyCode: String): [PayPalBalance!]!
    }

    # ── UC8 — Shipment Tracking ──────────────────────────────────────────────

    input AddPayPalShipmentTrackingInput {
        """The PayPal capture ID from the settled payment."""
        captureId: String!
        """Carrier tracking number."""
        trackingNumber: String
        """PayPal carrier code, e.g. UPS, FEDEX, USPS. Use OTHER + carrierNameOther for unlisted carriers."""
        carrier: String
        """Required when carrier is OTHER."""
        carrierNameOther: String
        """Send tracking email notification to the buyer."""
        notifyPayer: Boolean
    }

    type PayPalShipmentTrackingResult {
        """PayPal-assigned tracker ID (format: <captureId>-<trackingNumber>)."""
        trackerId: String!
        status: String!
    }

    extend type Mutation {
        """UC6 — Create a PayPal billing plan (INACTIVE by default; call activatePayPalBillingPlan next)."""
        createPayPalBillingPlan(input: CreatePayPalBillingPlanInput!): PayPalBillingPlan!

        """UC6 — Activate an INACTIVE PayPal billing plan so customers can subscribe."""
        activatePayPalBillingPlan(planId: String!): Boolean!

        """UC6 — Cancel a subscription on PayPal and mark it CANCELLED locally."""
        cancelPayPalSubscription(subscriptionId: String!, reason: String): Boolean!

        """UC6 — Retry a failed subscription payment: reactivates the suspended subscription and captures the outstanding balance."""
        capturePayPalSubscriptionPayment(subscriptionId: String!): Boolean!

        """UC8 — Attach shipment tracking to a captured PayPal order."""
        addPayPalShipmentTracking(orderId: String!, input: AddPayPalShipmentTrackingInput!): PayPalShipmentTrackingResult!

        """UC8 — Cancel the shipment tracking on a PayPal order."""
        cancelPayPalShipmentTracking(orderId: String!, trackerId: String!): Boolean!
    }
`;
