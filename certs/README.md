# certs/

## supabase-prod-ca-2021.crt

Supabase's **public root certificate authority**, published by Supabase for
download at Project Settings -> Database -> "Download certificate". It is not a
credential and contains nothing secret; it is committed here on purpose.

### Why it is committed rather than kept as a secret

The Postgres source (`OFFERS_SOURCE=postgres`) connects with certificate
verification ON. Supabase serves its database and pooler endpoints from this CA
rather than a publicly-trusted one, so Node rejects the connection with
`self-signed certificate in certificate chain` unless it is given this file.

The wrong fix - and the one the error message tempts you into - is
`rejectUnauthorized: false`. That was flagged in the 2026-09-23 public-safety
review: with verification off, anyone on the runner-to-database path can harvest
the role credentials from the startup packet AND serve arbitrary rows, which
this build would bake straight into a snapshot committed to a public repo. It is
both a credential-disclosure and a wrong-data vector.

Committing the CA keeps verification on with no secret to manage, no rotation
burden, and it works the same locally, in CI and for anyone cloning the repo.

### Overriding it

`DATABASE_CA_CERT` still takes precedence if set. Use it if Supabase rotates the
CA before this one expires (2031-04-26) or if the database moves to another
provider.
