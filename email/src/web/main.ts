import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { interceptLinks } from "./lib/router.svelte";

const target = document.getElementById("app")!;
interceptLinks(target);
mount(App, { target });
