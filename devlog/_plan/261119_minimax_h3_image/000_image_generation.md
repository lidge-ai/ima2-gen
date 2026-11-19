# H3 image generation

The MiniMax model picker exposes H3 Image and H3 Image Highspeed for text prompts.
Both use the regional `/v1/images/generations` endpoint. The application submits
one generation per requested image, gives each H3 call at least ten minutes,
and preserves the selected model in the result metadata.

The node route exercises image persistence and single submission on server
errors with mocked HTTP. Adapter tests cover regional routing, reference
rejection, URL downloads, embedded images, and per-image errors.
