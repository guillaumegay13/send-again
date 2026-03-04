const DEFAULT_SES_CONFIGURATION_SET = "email-tracking-config-set";

export function getSesConfigurationSetName(): string {
  const value =
    process.env.SES_CONFIGURATION_SET?.trim() ??
    process.env.SES_CONFIG_SET?.trim() ??
    "";
  return value || DEFAULT_SES_CONFIGURATION_SET;
}
