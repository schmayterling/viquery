# fixture sources

tiny end-to-end library. derived (resized / re-encoded) from:

- cat.jpg: scikit-image `chelsea.png`, cc0, stefan van der walt
- coffee.jpg: scikit-image `coffee.png`, cc0, rachel michetti
- launch.mp4: 0-5.5s scikit-image `rocket.jpg` (public domain, spacex), 5.5-11s `astronaut.png` (public domain, nasa); audio: whisper `jfk.flac` (public domain, us government work: "and so my fellow americans, ask not what your country can do for you, ask what you can do for your country")

expected: "a cat" -> cat.jpg; "a cup of coffee" -> coffee.jpg; "a rocket launching" -> launch.mp4 moment within 0-5.5s; "an astronaut" -> launch.mp4 moment within 5.5-11s; "ask what you can do for your country" -> launch.mp4 via speech.
