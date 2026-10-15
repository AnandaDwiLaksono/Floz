import { removeQaContainers } from '../e2e-environment';

export default function teardown() {
  removeQaContainers();
}
