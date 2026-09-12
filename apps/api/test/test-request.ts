import supertest from 'supertest';

let ipCounter = 1;

export function request(server: unknown): supertest.Agent {
  const agent = supertest(server as never);
  const origPost = agent.post.bind(agent);
  const origPatch = agent.patch.bind(agent);
  const origPut = agent.put.bind(agent);
  const origDelete = agent.delete.bind(agent);

  const nextIp = () => {
    const id = ipCounter++;
    return `198.51.100.${(id % 250) + 1}`;
  };

  agent.post = ((url: string, callback?: never) =>
    origPost(url, callback)
      .set('Origin', 'http://localhost:3000')
      .set('X-Forwarded-For', nextIp())) as never;
  agent.patch = ((url: string, callback?: never) =>
    origPatch(url, callback)
      .set('Origin', 'http://localhost:3000')
      .set('X-Forwarded-For', nextIp())) as never;
  agent.put = ((url: string, callback?: never) =>
    origPut(url, callback)
      .set('Origin', 'http://localhost:3000')
      .set('X-Forwarded-For', nextIp())) as never;
  agent.delete = ((url: string, callback?: never) =>
    origDelete(url, callback)
      .set('Origin', 'http://localhost:3000')
      .set('X-Forwarded-For', nextIp())) as never;

  return agent;
}

export default request;
