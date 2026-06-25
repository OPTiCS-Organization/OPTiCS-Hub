export type ServicePortMapping = {
  hostPort: number;
  containerPort: number;
};

export type ServiceSourceRepository = {
  url: string;
  rootDirectory?: string | null;
};

export type ServiceSourceInput = string | string[] | ServiceSourceRepository[];
