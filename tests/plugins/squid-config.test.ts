import { describe, expect, test } from "bun:test";
import { generateSquidConf } from "../../src/plugins/code-executor/docker/manager";

describe("generateSquidConf", () => {
  const defaultDomains = [
    ".anthropic.com",
    ".npmjs.org",
    ".npmjs.com",
    ".yarnpkg.com",
    ".pypi.org",
    ".pythonhosted.org",
    ".github.com",
    ".githubusercontent.com",
    ".githubassets.com",
    ".bun.sh",
    ".debian.org",
    ".ubuntu.com",
  ];

  test("generates valid squid config with default domains", () => {
    const conf = generateSquidConf(defaultDomains);

    expect(conf).toContain("http_port 3128");
    expect(conf).toContain("acl allowed_domains dstdomain .anthropic.com");
    expect(conf).toContain("acl allowed_domains dstdomain .npmjs.org");
    expect(conf).toContain("acl allowed_domains dstdomain .github.com");
    expect(conf).toContain("acl allowed_domains dstdomain .bun.sh");
    expect(conf).toContain("acl allowed_domains dstdomain .pypi.org");

    // Every default domain should appear as an ACL line
    for (const domain of defaultDomains) {
      expect(conf).toContain(`acl allowed_domains dstdomain ${domain}`);
    }
  });

  test("includes custom domains from config", () => {
    const customDomains = [".example.com", ".myapi.io"];
    const conf = generateSquidConf(customDomains);

    expect(conf).toContain("acl allowed_domains dstdomain .example.com");
    expect(conf).toContain("acl allowed_domains dstdomain .myapi.io");
    // Custom domains should not include default ones unless passed in
    expect(conf).not.toContain(".anthropic.com");
  });

  test("denies all by default", () => {
    const conf = generateSquidConf([".example.com"]);

    expect(conf).toContain("http_access deny all");
    // The allow rule should come before the deny all
    const allowIndex = conf.indexOf("http_access allow localnet allowed_domains");
    const denyAllIndex = conf.indexOf("http_access deny all");
    expect(allowIndex).toBeGreaterThan(-1);
    expect(denyAllIndex).toBeGreaterThan(-1);
    expect(allowIndex).toBeLessThan(denyAllIndex);
  });

  test("allows CONNECT for SSL ports only", () => {
    const conf = generateSquidConf([".example.com"]);

    expect(conf).toContain("acl SSL_ports port 443");
    expect(conf).toContain("acl CONNECT method CONNECT");
    expect(conf).toContain("http_access deny CONNECT !SSL_ports");
  });
});
