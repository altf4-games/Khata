// A read made while Anon-RPC restarts waits for the new worker rather than failing with a raw TypeError.
import { expect, test } from "@playwright/test";
import { waitFor } from "../src/wait";

test("waits until the thing exists", async () => {
  let w: string | undefined;
  setTimeout(() => (w = "worker"), 150);
  await expect(waitFor(() => w, () => undefined, 2000, 20)).resolves.toBe("worker");
});
test("stops with a plain reason when told to", async () => {
  await expect(waitFor(() => undefined, () => "Anonymous reads are unavailable.", 2000, 20)).rejects.toThrow("Anonymous reads are unavailable.");
});
test("gives up with a plain message after its deadline", async () => {
  await expect(waitFor(() => undefined, () => undefined, 100, 20)).rejects.toThrow(/still restarting/);
});
