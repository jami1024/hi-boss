export const SUPPORTED_ADAPTER_TYPES = ["telegram", "feishu", "web"] as const;

export type SupportedAdapterType = (typeof SUPPORTED_ADAPTER_TYPES)[number];

export function isSupportedAdapterType(value: string): value is SupportedAdapterType {
  return SUPPORTED_ADAPTER_TYPES.includes(value as SupportedAdapterType);
}
