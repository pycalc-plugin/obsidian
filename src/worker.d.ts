declare module "pyworker.worker" {
    const WorkerFactory: new () => Worker;
    export default WorkerFactory;
}
