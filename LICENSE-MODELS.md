# Licence for models and results

The trained models, checkpoints and results in this repository were made from the BOXRR-23 dataset. BOXRR-23 is
licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) with a data use agreement. So
these files are released under the same licence:

**Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)**
Legal code: https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode

## What it covers

- The ONNX models in `jacob/models/` and `nic/models/`
- The submitted model in `Submission/Motion_Pending_headpose/`: `model_fp32.onnx` and the checkpoint and training
  records in `weights/`
- The results, scores and analyses in `bench/results/`, `jacob/ablations/`, `nic/results/`, `nic/pc_runs/` and
  `LEADERBOARD.md`
- The user split lists in `bench/trained_on/`, `bench/definitions/`, `nic/splits/` and `ray/manifests/`

The source code is MIT-licensed: see `LICENSE`.

## Attribution

Copyright (c) 2026 Jacob Dorrill, Nicholas Groenewald, Ray Crowley, Duncan O'Regan, Ruairi O'Reilly and Jing Hua Ye
(team Motion_Pending and its supervisors).

If you use these files, cite our paper (see `CITATION.cff`) and BOXRR-23, as its data use agreement asks:

- V. Nair, W. Guo, R. Wang, J. F. O'Brien, L. Rosenberg and D. Song, "Berkeley Open Extended Reality Recordings
  2023 (BOXRR-23): 4.7 Million Motion Capture Recordings from 105,000 XR Users," *IEEE Transactions on
  Visualization and Computer Graphics*, vol. 30, no. 5, pp. 2239–2246, 2024.
- V. Nair, W. Guo, J. Mattern, R. Wang, J. F. O'Brien, L. Rosenberg and D. Song, "Unique Identification of 50,000+
  Virtual Reality Users from Head & Hand Motion Data," in *Proc. 32nd USENIX Security Symposium*, pp. 895–910, 2023
  (arXiv:2302.08927).

## Restrictions carried over from BOXRR-23

Its data use agreement applies to anything derived from the data. In particular (BOXRR-23 datasheet and data
nutrition label, <https://rdi.berkeley.edu/metaverse/boxrr-23/>):
- no attempt to link users to their real-world identities (re-identification)
- no attempt to contact the users
- no inference of sensitive attributes
- no use for health research

This repository contains none of the BOXRR-23 recordings themselves. To get the data, go to
https://rdi.berkeley.edu/metaverse/boxrr-23/
