const fs = require("fs");
const path = require("path");
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");

const NETWORK_SECURITY_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
      <certificates src="user" />
    </trust-anchors>
  </base-config>
</network-security-config>
`;

function ensureApplication(manifest) {
  const app = manifest?.manifest?.application?.[0];
  if (!app) throw new Error("AndroidManifest.xml missing application node");
  app.$ = app.$ || {};
  return app;
}

module.exports = function withAndroidNetworkSecurity(config) {
  config = withAndroidManifest(config, (config) => {
    const app = ensureApplication(config.modResults);
    app.$["android:usesCleartextTraffic"] = "true";
    app.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    return config;
  });

  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const xmlDir = path.join(config.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, "network_security_config.xml"), NETWORK_SECURITY_XML);
      return config;
    }
  ]);

  return AndroidConfig.Permissions.withPermissions(config, []);
};
