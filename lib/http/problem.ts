import { ZodError } from "zod";

import { ConfigurationError } from "@/lib/env.server";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly errors?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function toProblem(error: unknown, request: Request, requestId: string) {
  if (error instanceof ZodError) {
    return {
      status: 422,
      body: {
        type: "https://cherrydoodle.example/problems/validation-error",
        title: "Request validation failed",
        status: 422,
        code: "VALIDATION_ERROR",
        detail: "One or more fields are invalid.",
        instance: new URL(request.url).pathname,
        requestId,
        errors: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
    };
  }

  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        type: `https://cherrydoodle.example/problems/${error.code.toLowerCase().replaceAll("_", "-")}`,
        title: error.message,
        status: error.status,
        code: error.code,
        detail: error.message,
        instance: new URL(request.url).pathname,
        requestId,
        ...(error.errors ? { errors: error.errors } : {}),
      },
    };
  }

  if (error instanceof ConfigurationError) {
    return {
      status: 503,
      body: {
        type: "https://cherrydoodle.example/problems/service-unavailable",
        title: "Backend service is not configured",
        status: 503,
        code: "SERVICE_UNAVAILABLE",
        detail: error.message,
        instance: new URL(request.url).pathname,
        requestId,
      },
    };
  }

  return {
    status: 500,
    body: {
      type: "https://cherrydoodle.example/problems/internal-error",
      title: "Internal server error",
      status: 500,
      code: "INTERNAL_ERROR",
      detail: "The request could not be completed.",
      instance: new URL(request.url).pathname,
      requestId,
    },
  };
}
