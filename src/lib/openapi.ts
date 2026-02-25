export const openapiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Send Again API",
    version: "1.0.0",
    description:
      "Email sending and contact management API. Authenticate with a Supabase JWT or an API key (contacts endpoints only).",
  },
  servers: [{ url: "/", description: "Current host" }],
  components: {
    securitySchemes: {
      jwt: {
        type: "http" as const,
        scheme: "bearer",
        description: "Supabase JWT token. Works on all endpoints.",
      },
      apiKey: {
        type: "http" as const,
        scheme: "bearer",
        description:
          'API key (starts with "sk_"). Only works on /api/contacts endpoints. When used, the workspace query param is ignored — the workspace is resolved from the key.',
      },
    },
    schemas: {
      Contact: {
        type: "object",
        properties: {
          email: { type: "string", format: "email" },
          fields: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Arbitrary key-value metadata. All values are strings.",
          },
        },
        required: ["email"],
      },
      ApiKeyMeta: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          workspaceId: { type: "string" },
          name: { type: "string" },
          keyPrefix: { type: "string", description: "First 10 chars of the key" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      ApiKeyCreated: {
        type: "object",
        properties: {
          key: { type: "string", description: "Full plaintext key. Only returned at creation time." },
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          keyPrefix: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Workspace: {
        type: "object",
        properties: {
          id: { type: "string", description: "Domain name, e.g. example.com" },
          name: { type: "string" },
          from: { type: "string", format: "email" },
          configSet: { type: "string" },
          rateLimit: { type: "integer" },
          footerHtml: { type: "string" },
          websiteUrl: { type: "string", format: "uri" },
          contactSourceProvider: { type: "string", enum: ["manual", "http_json"] },
          contactSourceConfig: { type: "object", additionalProperties: { type: "string" } },
          verified: { type: "boolean" },
        },
      },
      SendJob: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          workspaceId: { type: "string" },
          status: { type: "string", enum: ["queued", "running", "completed", "failed", "cancelled"] },
          total: { type: "integer" },
          sent: { type: "integer" },
          failed: { type: "integer" },
          dryRun: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
          startedAt: { type: ["string", "null"], format: "date-time" },
          completedAt: { type: ["string", "null"], format: "date-time" },
          heartbeatAt: { type: ["string", "null"], format: "date-time" },
          updatedAt: { type: ["string", "null"], format: "date-time" },
          subject: { type: "string" },
          errorMessage: { type: ["string", "null"] },
        },
      },
      SendJobProgress: {
        allOf: [
          { $ref: "#/components/schemas/SendJob" },
          {
            type: "object",
            properties: {
              remaining: { type: "integer" },
              recentErrors: { type: "array", items: { type: "string" } },
              percent: { type: "number" },
              isDone: { type: "boolean" },
              rateLimit: { type: "integer" },
              batchSize: { type: "integer" },
              sendConcurrency: { type: "integer" },
            },
          },
        ],
      },
      HistoryEntry: {
        type: "object",
        properties: {
          messageId: { type: "string" },
          recipient: { type: "string", format: "email" },
          subject: { type: "string" },
          sentAt: { type: "string", format: "date-time" },
          events: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["Send", "Delivery", "Open", "Click", "Bounce", "Complaint"] },
                timestamp: { type: "string", format: "date-time" },
                detail: { type: "string" },
              },
            },
          },
        },
      },
      Ok: {
        type: "object",
        properties: { ok: { type: "boolean", const: true } },
      },
      Error: {
        type: "object",
        properties: { error: { type: "string" } },
      },
    },
  },
  paths: {
    // ── Contacts ──────────────────────────────────────────────
    "/api/contacts": {
      get: {
        operationId: "listContacts",
        summary: "List all contacts in a workspace",
        tags: ["Contacts"],
        security: [{ jwt: [] }, { apiKey: [] }],
        parameters: [
          {
            name: "workspace",
            in: "query" as const,
            required: true,
            description: "Workspace ID (ignored when using API key auth)",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Array of contacts",
            content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Contact" } } } },
          },
        },
      },
      post: {
        operationId: "upsertContacts",
        summary: "Create or update contacts (upsert)",
        tags: ["Contacts"],
        security: [{ jwt: [] }, { apiKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["workspace", "contacts"],
                properties: {
                  workspace: { type: "string" },
                  contacts: { type: "array", items: { $ref: "#/components/schemas/Contact" } },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Full updated contacts list",
            content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Contact" } } } },
          },
          "400": {
            description: "Validation error",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
      delete: {
        operationId: "deleteAllContacts",
        summary: "Delete all contacts in a workspace",
        tags: ["Contacts"],
        security: [{ jwt: [] }, { apiKey: [] }],
        parameters: [
          {
            name: "workspace",
            in: "query" as const,
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Success",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } },
          },
        },
      },
    },
    "/api/contacts/{email}": {
      get: {
        operationId: "getContact",
        summary: "Get a single contact by email",
        tags: ["Contacts"],
        security: [{ jwt: [] }, { apiKey: [] }],
        parameters: [
          { name: "email", in: "path" as const, required: true, schema: { type: "string", format: "email" } },
          { name: "workspace", in: "query" as const, required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Contact found",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } },
          },
          "404": {
            description: "Contact not found",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
      put: {
        operationId: "updateContact",
        summary: "Update a contact's fields",
        tags: ["Contacts"],
        security: [{ jwt: [] }, { apiKey: [] }],
        parameters: [
          { name: "email", in: "path" as const, required: true, schema: { type: "string", format: "email" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["workspace"],
                properties: {
                  workspace: { type: "string" },
                  fields: { type: "object", additionalProperties: { type: "string" } },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Success",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } },
          },
        },
      },
      delete: {
        operationId: "deleteContact",
        summary: "Delete a single contact by email",
        tags: ["Contacts"],
        security: [{ jwt: [] }, { apiKey: [] }],
        parameters: [
          { name: "email", in: "path" as const, required: true, schema: { type: "string", format: "email" } },
          { name: "workspace", in: "query" as const, required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Success",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } },
          },
        },
      },
    },

    // ── API Keys ──────────────────────────────────────────────
    "/api/keys": {
      get: {
        operationId: "listApiKeys",
        summary: "List API keys for a workspace",
        tags: ["API Keys"],
        security: [{ jwt: [] }],
        parameters: [
          { name: "workspace", in: "query" as const, required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Array of key metadata (plaintext key is never returned on list)",
            content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/ApiKeyMeta" } } } },
          },
        },
      },
      post: {
        operationId: "createApiKey",
        summary: "Create a new API key",
        tags: ["API Keys"],
        security: [{ jwt: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["workspace"],
                properties: {
                  workspace: { type: "string" },
                  name: { type: "string", default: "" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Created key with plaintext value (only shown once)",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ApiKeyCreated" } } },
          },
        },
      },
    },
    "/api/keys/{id}": {
      delete: {
        operationId: "deleteApiKey",
        summary: "Revoke an API key",
        tags: ["API Keys"],
        security: [{ jwt: [] }],
        parameters: [
          { name: "id", in: "path" as const, required: true, schema: { type: "string", format: "uuid" } },
          { name: "workspace", in: "query" as const, required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Success",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } },
          },
          "404": {
            description: "Key not found",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },

    // ── Workspaces ────────────────────────────────────────────
    "/api/workspaces": {
      get: {
        operationId: "listWorkspaces",
        summary: "List workspaces accessible to the authenticated user",
        tags: ["Workspaces"],
        security: [{ jwt: [] }],
        responses: {
          "200": {
            description: "Array of workspaces",
            content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Workspace" } } } },
          },
        },
      },
      post: {
        operationId: "createWorkspace",
        summary: "Create a new workspace (domain)",
        tags: ["Workspaces"],
        security: [{ jwt: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["id"],
                properties: {
                  id: { type: "string", description: "Domain name, e.g. example.com" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Created workspace",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Workspace" } } },
          },
          "400": {
            description: "Invalid domain",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/workspaces/settings": {
      put: {
        operationId: "updateWorkspaceSettings",
        summary: "Update workspace settings",
        tags: ["Workspaces"],
        security: [{ jwt: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["id", "from"],
                properties: {
                  id: { type: "string" },
                  from: { type: "string", format: "email" },
                  configSet: { type: "string", default: "email-tracking-config-set" },
                  rateLimit: { type: "integer", default: 300 },
                  footerHtml: { type: "string", default: "" },
                  websiteUrl: { type: "string", format: "uri" },
                  contactSourceProvider: { type: "string", enum: ["manual", "http_json"] },
                  contactSourceConfig: { type: "object", additionalProperties: { type: "string" } },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Success",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } },
          },
          "400": {
            description: "Validation error",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },

    // ── Send ──────────────────────────────────────────────────
    "/api/send": {
      post: {
        operationId: "sendEmails",
        summary: "Send emails to recipients",
        tags: ["Send"],
        security: [{ jwt: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["workspaceId", "from", "subject", "html"],
                properties: {
                  workspaceId: { type: "string" },
                  from: { type: "string", format: "email", description: "Must match workspaceId domain" },
                  to: { type: "array", items: { type: "string", format: "email" }, description: "Required when recipientMode is manual" },
                  recipientMode: {
                    type: "string",
                    enum: ["manual", "all_contacts", "verified_contacts", "unverified_contacts"],
                    default: "manual",
                  },
                  subject: { type: "string" },
                  html: { type: "string", description: "Email body HTML" },
                  dryRun: { type: "boolean", default: false, description: "If true, returns recipient count without sending" },
                  configSet: { type: "string" },
                  rateLimit: { type: "integer" },
                  footerHtml: { type: "string" },
                  websiteUrl: { type: "string", format: "uri" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Send initiated or dry-run result",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    {
                      type: "object",
                      description: "Dry-run result",
                      properties: {
                        sent: { type: "integer" },
                        skippedUnsubscribed: { type: "integer" },
                        dryRun: { type: "boolean", const: true },
                      },
                    },
                    {
                      type: "object",
                      description: "Job created",
                      properties: {
                        jobId: { type: "string", format: "uuid" },
                        status: { type: "string", const: "queued" },
                        total: { type: "integer" },
                        skippedUnsubscribed: { type: "integer" },
                        dryRun: { type: "boolean", const: false },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
    "/api/send/status": {
      get: {
        operationId: "getSendJobStatus",
        summary: "Get detailed status of a send job",
        tags: ["Send"],
        security: [{ jwt: [] }],
        parameters: [
          { name: "jobId", in: "query" as const, required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": {
            description: "Job progress",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SendJobProgress" } } },
          },
          "404": {
            description: "Job not found",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/send/jobs": {
      get: {
        operationId: "listSendJobs",
        summary: "List send jobs",
        tags: ["Send"],
        security: [{ jwt: [] }],
        parameters: [
          { name: "workspace", in: "query" as const, schema: { type: "string" }, description: "Filter by workspace" },
          { name: "limit", in: "query" as const, schema: { type: "integer", default: 50, minimum: 1 } },
          {
            name: "status",
            in: "query" as const,
            schema: { type: "string" },
            description: "Comma-separated status filter: queued,running,completed,failed,cancelled",
          },
        ],
        responses: {
          "200": {
            description: "Job list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    jobs: { type: "array", items: { $ref: "#/components/schemas/SendJob" } },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ── History ───────────────────────────────────────────────
    "/api/history": {
      get: {
        operationId: "getHistory",
        summary: "Get email send history for a workspace (last 100)",
        tags: ["History"],
        security: [{ jwt: [] }],
        parameters: [
          { name: "workspace", in: "query" as const, required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Send history entries, newest first",
            content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/HistoryEntry" } } } },
          },
        },
      },
    },
  },
} as const;
