import { afterEach, describe, expect, it } from "vitest";

import { cloudinaryPublicId, createCloudinaryUpload, createPrivateCloudinaryReadUrl } from "@/features/media/cloudinary-client";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function configureEnvironment() {
  Object.assign(process.env, {
    NODE_ENV: "test",
    CLOUDINARY_CLOUD_NAME: "test-cloud",
    CLOUDINARY_API_KEY: "1234567890",
    CLOUDINARY_API_SECRET: "test-api-secret",
    CLOUDINARY_PRIVATE_READ_URL_TTL_SECONDS: "900",
  });
}

describe("Cloudinary media signing", () => {
  it("creates a signed direct upload for a public image", () => {
    configureEnvironment();
    const publicId = cloudinaryPublicId("00000000-0000-4000-8000-000000000000", "product");
    const result = createCloudinaryUpload({ publicId, isPrivate: false });

    expect(result.uploadUrl).toBe("https://api.cloudinary.com/v1_1/test-cloud/image/upload");
    expect(result.fields.public_id).toBe(publicId);
    expect(result.fields.api_key).toBe("1234567890");
    expect(result.fields.overwrite).toBe("false");
    expect(result.fields.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.values(result.fields)).not.toContain("test-api-secret");
  });

  it("uses authenticated delivery and an expiring private URL", () => {
    configureEnvironment();
    const publicId = "cherry-doodle/test/order_customization/media-id";
    const upload = createCloudinaryUpload({ publicId, isPrivate: true });
    const readUrl = new URL(createPrivateCloudinaryReadUrl(publicId, "jpg", 300));

    expect(upload.uploadUrl).toBe("https://api.cloudinary.com/v1_1/test-cloud/image/authenticated");
    expect(readUrl.hostname).toBe("api.cloudinary.com");
    expect(readUrl.searchParams.get("type")).toBe("authenticated");
    expect(readUrl.searchParams.get("expires_at")).toMatch(/^\d+$/);
    expect(readUrl.searchParams.get("signature")).toMatch(/^[a-f0-9]{64}$/);
  });
});
