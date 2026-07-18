/**
 * Clears the local store so the demo starts from a clean slate.
 *
 *   npm run reset
 */
import { resetAll } from "../src/lib/store/store";

async function main() {
  await resetAll();
  console.log('FairMove store cleared. Run `npm run demo`, or press "Run the full loop" in the UI.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
