// Validator tests (rubric V1–V6): bad inputs like "ff", "me" and a bare
// maps/place URL must be rejected; valid shapes accepted; warnings only pass
// with explicit owner confirmation.
import { describe, expect, it } from "vitest";
import {
  isBusinessProfileComplete,
  isValidEmail,
  validateBusinessProfile,
  validateGoogleReviewUrl,
} from "./validation.js";

const goodProfile = {
  name: "Coppervale Heating & Air",
  ownerName: "Dana Whitlock",
  ownerEmail: "dana@coppervale.test",
  city: "Springfield",
  googleReviewUrl: "https://g.page/coppervale/review",
};

describe("emails (V2)", () => {
  it("rejects junk like ff, me, or a@b", () => {
    for (const bad of ["ff", "me", "a@b", "space out@x.test", "@x.test", "user@", "", "   "]) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });
  it("accepts normal addresses", () => {
    for (const ok of ["owner@example.com", "dana.whitlock+shop@sub.coppervale.test"]) {
      expect(isValidEmail(ok), ok).toBe(true);
    }
  });
});

describe("Google review link (V3, V6)", () => {
  it("requires https", () => {
    const r = validateGoogleReviewUrl("http://g.page/coppervale/review");
    expect(r.issues[0]?.severity).toBe("error");
    expect(r.issues[0]?.message).toMatch(/https/i);
  });

  it("rejects non-Google hosts", () => {
    const r = validateGoogleReviewUrl("https://reviews.example.com/place");
    expect(r.issues[0]?.severity).toBe("error");
    expect(r.issues[0]?.message).toMatch(/Google host/i);
  });

  it("rejects a bare maps/place URL with no place identifier (V6)", () => {
    const r = validateGoogleReviewUrl("https://www.google.com/maps/place");
    expect(r.issues[0]?.severity).toBe("error");
    // Confirmation cannot rescue the bare maps/place shape.
    const r2 = validateGoogleReviewUrl("https://www.google.com/maps/place", true);
    expect(r2.issues[0]?.severity).toBe("error");
    expect(r2.issues[0]?.message).toMatch(/without a place/i);
  });

  it("rejects the empty string", () => {
    expect(validateGoogleReviewUrl("").issues[0]?.severity).toBe("error");
  });

  it("accepts g.page, maps.app.goo.gl and goo.gl links", () => {
    for (const url of [
      "https://g.page/coppervale/review",
      "https://maps.app.goo.gl/AbCdEf123456",
      "https://goo.gl/maps/AbCdEf123456",
    ]) {
      expect(validateGoogleReviewUrl(url).issues, url).toEqual([]);
    }
  });

  it("accepts a google.com maps/place URL that has a place identifier", () => {
    expect(
      validateGoogleReviewUrl("https://www.google.com/maps/place/Coppervale+Heating/@34.1,-118.2,17z").issues,
    ).toEqual([]);
  });

  it("warns and requires confirmation for unrecognized shapes", () => {
    const bare = validateGoogleReviewUrl("https://www.google.com/maps");
    expect(bare.issues[0]?.severity).toBe("confirm");
    const search = validateGoogleReviewUrl("https://maps.google.com/?q=coffee");
    expect(search.issues[0]?.severity).toBe("confirm");
    // …and only passes once the owner confirmed.
    expect(validateGoogleReviewUrl("https://www.google.com/maps", false).issues.length).toBe(1);
    expect(validateGoogleReviewUrl("https://www.google.com/maps", true).issues).toEqual([]);
  });
});

describe("business profile (V1, V4, V5)", () => {
  it("rejects whitespace-only required fields and reports each field", () => {
    const { fieldErrors } = validateBusinessProfile({
      name: "   ",
      ownerName: "",
      ownerEmail: "ff",
      city: "",
      googleReviewUrl: "https://www.google.com/maps/place",
    });
    expect(Object.keys(fieldErrors).sort()).toEqual([
      "city",
      "googleReviewUrl",
      "name",
      "ownerEmail",
      "ownerName",
    ]);
  });

  it("rejects non-https website and social links (V4)", () => {
    const { fieldErrors } = validateBusinessProfile({
      ...goodProfile,
      website: "http://coppervale.test",
      socialLinks: { instagram: "ftp://example.com/ig", discord: "not a url" },
    });
    expect(fieldErrors.website).toMatch(/https/i);
    expect(fieldErrors["socialLinks.instagram"]).toMatch(/https/i);
    expect(fieldErrors["socialLinks.discord"]).toBeTruthy();
  });

  it("accepts the good profile", () => {
    const { fieldErrors, fieldWarnings } = validateBusinessProfile(goodProfile);
    expect(fieldErrors).toEqual({});
    expect(fieldWarnings).toEqual({});
    expect(isBusinessProfileComplete(goodProfile)).toBe(true);
  });

  it("is incomplete while a link warning is unconfirmed", () => {
    const unconfirmed = { ...goodProfile, googleReviewUrl: "https://www.google.com/maps" };
    expect(isBusinessProfileComplete(unconfirmed)).toBe(false);
    expect(
      isBusinessProfileComplete({ ...unconfirmed, googleReviewUrlConfirmed: true }),
    ).toBe(true);
  });

  it("trimmed values satisfy required checks (V1)", () => {
    // The server trims before storing; a padded-but-nonempty value is valid.
    const padded = {
      ...goodProfile,
      name: "  Coppervale Heating & Air  ",
      city: " Springfield ",
    };
    expect(isBusinessProfileComplete(padded)).toBe(true);
  });
});
