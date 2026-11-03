import { createContext, useContext, type ReactNode } from 'react';

export type ActiveEnvironment = {
  organizationId: string;
  name: string;
  center: string;
};

const ActiveEnvironmentContext = createContext<ActiveEnvironment | null>(null);

export function ActiveEnvironmentProvider({
  value,
  children,
}: {
  value: ActiveEnvironment | null;
  children: ReactNode;
}) {
  return <ActiveEnvironmentContext.Provider value={value}>{children}</ActiveEnvironmentContext.Provider>;
}

export function useActiveEnvironment() {
  return useContext(ActiveEnvironmentContext);
}

export function useActiveOrganizationId() {
  return useActiveEnvironment()?.organizationId ?? null;
}
