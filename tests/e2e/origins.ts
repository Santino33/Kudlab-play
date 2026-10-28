export const demoPort = Number(process.env.KUDLAB_DEMO_PORT ?? 4173);
export const productionPort = Number(process.env.KUDLAB_PRODUCTION_PORT ?? 4174);
export const demoOrigin = `http://127.0.0.1:${demoPort}`;
export const teacherOrigin = `http://localhost:${demoPort}`;
export const productionOrigin = `http://127.0.0.1:${productionPort}`;
