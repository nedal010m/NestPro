import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const rulesContent = fs.readFileSync("./DRAFT_firestore.rules", "utf8");

test("Firestore rules enforce all 12 Dirty Dozen security invariants", () => {
  // 1. Default-deny catch-all
  assert.ok(rulesContent.includes("match /{document=**} {\n      allow read, write: if false;"));

  // 2. Email verified check
  assert.ok(rulesContent.includes("request.auth.token.email_verified == true"));

  // 3. Identity spoofing guard
  assert.ok(rulesContent.includes("data.ownerId == request.auth.uid"));

  // 4 & 5. Shadow field injection guard (hasAll + hasOnly + affectedKeys().hasOnly)
  assert.ok(rulesContent.includes("data.keys().hasAll(["));
  assert.ok(rulesContent.includes("data.keys().hasOnly(["));
  assert.ok(rulesContent.includes("incoming().diff(existing()).affectedKeys().hasOnly(["));

  // 6 & 8. Immutability of ownerId and createdAt on update
  assert.ok(rulesContent.includes("incoming().ownerId == existing().ownerId"));
  assert.ok(rulesContent.includes("incoming().createdAt == existing().createdAt"));

  // 7. Temporal integrity using request.time
  assert.ok(rulesContent.includes("incoming().createdAt == request.time"));
  assert.ok(rulesContent.includes("incoming().updatedAt == request.time"));

  // 9. Path variable ID poisoning guard
  assert.ok(rulesContent.includes("isValidId(projectId)"));
  assert.ok(rulesContent.includes("isValidId(presetId)"));

  // 10. Volumetric bounds on strings and arrays
  assert.ok(rulesContent.includes("data.name.size() <= 120"));
  assert.ok(rulesContent.includes("data.shapes.size() <= 100"));
  assert.ok(rulesContent.includes("data.placements.size() <= 500"));

  // 11 & 12. Tenant isolation on get and list
  assert.ok(rulesContent.includes("allow list: if isSignedIn() && existing().ownerId == request.auth.uid;"));
});
