import { createResource } from "solid-js";
import { hello, version } from "~/logic/backend";

export function SomeComponent() {
  const [ver] = createResource(() => {
    return version();
  });

  const [message] = createResource(() => {
    return hello({
      name: "world",
      message: "I called an RPC function from the frontend!",
    });
  });

  return (
    <>
      <p>{ver()}</p>
      <p>{message()}</p>
    </>
  );
}
