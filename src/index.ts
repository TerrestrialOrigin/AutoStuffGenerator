export interface HelloWorldOptions {
    name: string;
}

export function helloWorld(options: HelloWorldOptions) {
    console.log(`Hello, ${options.name}!`);
}