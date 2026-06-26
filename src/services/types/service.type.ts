export type ServicePortMapping = {
  hostPort: number;
  containerPort: number;
};

export type ServiceEndpoint = ServicePortMapping & {
  componentName?: string | null;
  subdomain?: string | null;
};

export type ServiceSourceRepository = {
  url: string;
  rootDirectory?: string | null;
};

export type ServiceSourceInput = string | string[] | ServiceSourceRepository[];
