# Third-party data and notices

## BodyParts3D (anatomical meshes and names)

BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.

- Source: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/
- Licence: https://creativecommons.org/licenses/by/4.0/
- Terms: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html

The app downloads this data to the user's computer and converts it to its own format (`index.json` and `meshes.bin`). The conversion re-orients and re-scales the meshes, recomputes normals, and assigns display categories. The structure names and hierarchy are unchanged. The attribution line is shown in the app's status bar whenever the atlas is loaded.

Reference: Mitsuhashi N, et al. "BodyParts3D: 3D structure database for anatomical concepts." Nucleic Acids Research 37 (2009): D782-D785.

## BodyParts3D 4.3 download method

The full-resolution 4.3 meshes are fetched from the Anatomography viewer back end (https://lifesciencedb.jp/bp3d/), following the method documented by https://github.com/olivercase/body_parts_3d_api (MIT). Mesh components whose ID ends in "M" are BodyParts3D's own mirrored models. Earlier releases were published under CC BY-SA 2.1 Japan, and the current licence page states CC BY 4.0. Attribute DBCLS / BodyParts3D in either case.

## Mirrored copies made by this app

When an atlas models a muscle on one side only, the app can add a mirror-image copy on the other side. These copies are derived from the source meshes, flagged as mirrored in the data and in the interface, and carry the source's licence and attribution.

## Z-Anatomy

Downloaded from the per-system glTF export at https://github.com/nqwrc/3d-anatomy (pinned commit), which is exported from the Z-Anatomy atlas. Required attributions, as given in the upstream `models/License.txt`:

- "BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan"
- "Z-Anatomy - The open source atlas of anatomy - CC-BY-SA 4.0"
- "Cranial Nerves and Foramina - by University of Dundee, CAHID - CC-BY 4.0"
- "Anatomy of the Inner Ear - by University of Dundee School of Medicine - CC-BY-NC-SA 4.0"
- "Kidney - by lissiecowley - CC-BY-NC 4.0"
- "Brainder" and "White matter" from the University of Washington

Because of the inner ear and kidney models, the Z-Anatomy atlas as downloaded is for **non-commercial use only** (CC BY-NC-SA 4.0). Building with `--commercial-safe` (or the matching option in the app) leaves those meshes out, and the remainder is CC BY-SA 4.0. Z-Anatomy definitions come from Wikipedia (CC BY-SA 3.0 / GFDL). Latin names come from the Z-Anatomy lexicon.

The Draco mesh decoder (`draco_decoder.js`, Google, Apache License 2.0) is downloaded together with the Z-Anatomy files and is used only to read them.

## Wikipedia (descriptions)

When online, the app shows short introductory extracts from English Wikipedia articles. That text is available under the Creative Commons Attribution-ShareAlike licence, and each extract links to its source article.

## Foundational Model of Anatomy

Structure IDs and English names follow the Foundational Model of Anatomy (FMA) ontology as distributed with BodyParts3D.
