import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// The anonymised fixtures of the sandbox repository must hold nothing that identifies a person, an organisation or a tenant.
const DIR = new URL('./fixtures/pr-status/azure/', import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// Placeholders that the README lists: project, repository, user, tenant (with its A prefix), and the policy and evaluation ids.
// The one real id kept is the type id of the merge strategy policy, the same in every organisation.
const PLACEHOLDER = /^(?:0{8}-0{4}-4000-8000-0{9}[0-9a-f]{3}|fa4e907d-c16b-4a4c-9dfa-4916e5d171ab)$/;
// Identities and tenants always sit in these places; everything else (unique ids of a discussion, commit ids) is no identity.
const IDENTITY = /"(?:id|descriptor|uniqueName|email)": "([^"]*)"|Identities\/([^"]*)"|\/A([0-9a-f-]{36})\//gi;

test('there are fixtures of threads and statuses', () => {
  assert.ok(files.some((f) => f.endsWith('.threads.json')));
  assert.ok(files.some((f) => f.endsWith('.statuses.json')));
});

for (const file of files) {
  const text = readFileSync(new URL(file, DIR), 'utf8');
  test(`${file} holds no e-mail address, organisation, tenant or identity id`, () => {
    const mails = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [];
    assert.deepEqual(
      mails.filter((m) => !/@example\.test$/.test(m) && !/^(?:example-org@dev|git@ssh\.dev)\.azure\.com$/.test(m)),
      [],
    );
    const orgs = [...text.matchAll(/dev\.azure\.com\/([\w.-]+)/g)].map((m) => m[1]);
    assert.deepEqual(
      orgs.filter((o) => o !== 'example-org'),
      [],
    );
    assert.doesNotMatch(text, /aad\.(?!REDACTED)[\w-]+/);
    for (const m of text.matchAll(IDENTITY)) {
      const value = m[1] ?? m[2] ?? m[3];
      if (GUID.test(value)) assert.match(value, PLACEHOLDER, `${file}: ${value}`);
      GUID.lastIndex = 0;
    }
  });
}
