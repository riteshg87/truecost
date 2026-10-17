const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN;

if (!issuer) {
  throw new Error("CLERK_JWT_ISSUER_DOMAIN is required to configure Convex auth");
}

export default {
  providers: [{ domain: issuer, applicationID: "convex" }],
};
