import { helloWorld } from './index';

describe('helloWorld', () => {
  it('should log "Hello, world!"', () => {
    const consoleSpy = jest.spyOn(console, 'log');
    helloWorld({ name: "Jerry" });
    expect(consoleSpy).toHaveBeenCalledWith('Hello, Jerry!');
    consoleSpy.mockRestore();

  });
});
