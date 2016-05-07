(function () {
    window.CiteState = {
        scriptRoot:""
    };

    var NES = "NES";
    var SNES = "SNES";
    var DOS = "DOS";

    var FCEUX = "FCEUX";
    var SNES9X = "SNES9X";
    var DOSBOX = "DOSBOX";

    var EmulatorNames = {};
    EmulatorNames[NES] = FCEUX;
    EmulatorNames[SNES] = SNES9X;
    EmulatorNames[DOS] = DOSBOX;

    var LoadedEmulators = {};

    var EmulatorInstances = {};
    EmulatorInstances[FCEUX] = [];
    EmulatorInstances[SNES9X] = [];
    EmulatorInstances[DOSBOX] = [];

    function determineSystem(gameFile) {
        if (gameFile.match(/\.(smc|sfc)$/i)) {
            return SNES;
        } else if (gameFile.match(/\.(exe|com|bat|dos|iso)$/i)) {
            return DOS;
        } else if (gameFile.match(/\.(nes|fds)$/i)) {
            return NES;
        }
        throw new Error("Unrecognized System");
    }

    function realCite(targetID, onLoad, system, emulator, gameFile, freezeFile, otherFiles, options) {
        var emuModule = LoadedEmulators[emulator];
        if (!emuModule) {
            throw new Error("Emulator Not Loaded");
        }
        //todo: compile everybody with -s modularize and export name to FCEUX, SNES9X, DOSBOX.
        //todo: and be sure that gameFile, freezeFile, and extraFiles are used appropriately.
        var targetElement = document.getElementById(targetID);
        targetElement.innerHTML = "";
        targetElement.tabIndex = 0;
        targetElement.addEventListener("click", function() {
            targetElement.focus();
        });
        var canvas = (function() {
            var canvas = document.createElement("canvas");
            // canvas.width = targetElement.clientWidth;
            // canvas.height = targetElement.clientHeight;
            canvas.style.setProperty( "width", "inherit", "important");
            canvas.style.setProperty("height", "inherit", "important");
            targetElement.appendChild(canvas);

            // As a default initial behavior, pop up an alert when webgl context is lost. To make your
            // application robust, you may want to override this behavior before shipping!
            // See http://www.khronos.org/registry/webgl/specs/latest/1.0/#5.15.2
            canvas.addEventListener("webglcontextlost", function(e) {
                alert('WebGL context lost. You will need to destroy and recreate this widget.');
                e.preventDefault();
            }, false);
            return canvas;
        })();
        var instance;
        var moduleObject = {
            locateFile: function(url) {
                return window.CiteState.scriptRoot+"emulators/"+url;
            },
            targetID:targetID,
            keyboardListeningElement:targetElement,
            system:system,
            emulator:emulator,
            gameFile:gameFile,
            freezeFile:freezeFile,
            extraFiles:otherFiles,
            preRun: [],
            postRun: [],
            print: function(m) { console.log(m); },
            printErr: function(e) { console.error(e); },
            canvas: canvas,
            options: options || {}
        };
        instance = emuModule(moduleObject);
        instance.postRun.push(function() {
            instance.setMuted("mute" in options ? options.mute : true);
            if(onLoad) { onLoad(instance); }
            if(options && ("recorder" in options)) {
                Recorder.recorderRoot = window.CiteState.scriptRoot+"recorder/";
                if(!instance.getAudioCaptureInfo) {
                    throw "Can't record unless audio recording contexts are given by the emulator";
                }
                instance.startRecording = function(cb) {
                    if(instance.recording) {
                        console.error("Can't record two videos at once for one emulator");
                        return;
                    }
                    instance.recording = true;
                    instance.audioInfo = instance.getAudioCaptureInfo();
                    var sampleRate = instance.audioInfo.context.sampleRate;
                    instance.audioSampleRate = sampleRate;
                    var bufferSize = 16384;
                    instance.audioCaptureNode = instance.audioInfo.context.createScriptProcessor(bufferSize,2,2);
                    instance.audioCaptureBuffer = new Float32Array(sampleRate*2);
                    instance.audioCaptureStartSample = 0;
                    instance.audioCaptureOffset = 0;
                    instance.audioCaptureNode.onaudioprocess = function(e) {
                        var input = e.inputBuffer;
                        var output = e.outputBuffer;
                        var in0 = input.getChannelData(0);
                        var in1 = input.getChannelData(1);
                        var out0 = output.getChannelData(0);
                        var out1 = output.getChannelData(1);
                        var capture = instance.audioCaptureBuffer;
                        var captureOffset = instance.audioCaptureOffset;
                        var sampleRate = instance.audioSampleRate;
                        //todo: is this all right? the buffers seem to be getting too big when the worker thread finally gets them...
                        if(instance.recording) {
                            for(var i = 0; i < bufferSize; i++) {
                                out0[i] = in0[i];
                                out1[i] = in1[i];
                                capture[captureOffset] = in0[i];
                                capture[captureOffset+1] = in1[i];
                                captureOffset+=2;
                                if(captureOffset >= sampleRate*2) {
                                    if(capture.length > sampleRate*2) {
                                        console.error("Capture too long!");
                                    }
                                    Recorder.addAudioFrame(instance.recordingID, instance.audioCaptureStartSample, capture);
                                    instance.audioCaptureStartSample += sampleRate;
                                    capture = new Float32Array(sampleRate*2);
                                    instance.audioCaptureBuffer = capture;
                                    captureOffset = 0;
                                }
                            }
                            instance.audioCaptureOffset = captureOffset;
                        } else {
                            for(var i = 0; i < bufferSize; i++) {
                                out0[i] = in0[i];
                                out1[i] = in1[i];
                            }
                        }
                    };
                    Recorder.startRecording(instance.canvas.width, instance.canvas.height, window.CiteState.canvasCaptureFPS, sampleRate, function(rid) {
                        console.log("Aud:",instance.audioInfo);
                        var audioCtx = instance.audioInfo.context;
                        var sampleRate = audioCtx.sampleRate;
                        var dest = audioCtx.destination;
                        var src = instance.audioInfo.capturedNode;
                        var captureNode = instance.audioCaptureNode;
                        
                        instance.recordingID = rid;
                        instance.recordingStartFrame = window.CiteState.canvasCaptureCurrentFrame();
                        //hook up audio capture
                        if(!instance.wasAudioCaptured){
                            src.disconnect(dest);
                            src.connect(captureNode);
                            captureNode.connect(dest);
                            instance.wasAudioCaptured = true;
                        } else {
                            src.connect(captureNode);
                            captureNode.connect(dest);
                        }
                        //hook up video capture
                        instance.captureContext = instance.canvas.getContext("2d");
                        window.CiteState.canvasCaptureOne(instance, 0);
                        window.CiteState.liveRecordings.push(instance);
                        if(!window.CiteState.canvasCaptureTimer) {
                            window.CiteState.canvasCaptureTimer = requestAnimationFrame(window.CiteState.canvasCaptureTimerFn);
                        }
                        if(cb) {
                            cb(instance.recordingID);
                        }
                    });
                };
                instance.finishRecording = function(cb) {
                    Recorder.finishRecording(instance.recordingID, cb);
                    instance.recording = false;
                    instance.recordingID = -1;
                    window.CiteState.liveRecordings.splice(window.CiteState.liveRecordings.indexOf(instance),1);
                };
                instance.recording = false;
                instance.wasAudioCaptured = false;
                if(options.recorder.autoStart) {
                    instance.startRecording(null);
                }
            }
        });
        EmulatorInstances[emulator].push(instance);
        return instance;
    }
    
    window.CiteState.liveRecordings = [];
    window.CiteState.canvasCaptureTimerRunTime = 0;
    window.CiteState.canvasCaptureStartTime = 0;
    window.CiteState.canvasCaptureLastCapturedTime = 0;
    window.CiteState.canvasCaptureFPS = 30;
    window.CiteState.timeToFrame = function(timeInSeconds) {
        //seconds * (frames/second)
        return Math.floor(timeInSeconds * (window.CiteState.canvasCaptureFPS));
    };
    window.CiteState.canvasCaptureCurrentFrame = function() {
        //seconds * (frames/second)
        return window.CiteState.timeToFrame(window.CiteState.canvasCaptureLastCapturedTime);
    };
    window.CiteState.canvasCaptureOne = function(emu, frame) {
        if(frame <= emu.lastCapturedFrame) {
            console.error("Redundant capture",frame);
        }
        emu.lastCapturedFrame = frame;
        Recorder.addVideoFrame(
            emu.recordingID,
            frame,
            emu.captureContext.getImageData(0, 0, emu.canvas.width, emu.canvas.height).data
        );
    };
    window.CiteState.canvasCaptureTimerFn = function(timestamp) {
        //convert to seconds
        timestamp = timestamp / 1000.0;
        if(window.CiteState.canvasCaptureStartTime == 0) {
            window.CiteState.canvasCaptureStartTime = timestamp;
        }
        timestamp = timestamp - window.CiteState.canvasCaptureStartTime;
        if(window.CiteState.canvasCaptureLastCapturedTime == 0) {
            window.CiteState.canvasCaptureLastCapturedTime = timestamp;
        }
        var lastFrame = window.CiteState.canvasCaptureCurrentFrame();
        var newFrame = window.CiteState.timeToFrame(timestamp);
        if(lastFrame != newFrame) {
            window.CiteState.canvasCaptureLastCapturedTime = timestamp;
            for(var i = 0; i < window.CiteState.liveRecordings.length; i++) {
                var emu = window.CiteState.liveRecordings[i];
                if(!emu.recording) { continue; }
                window.CiteState.canvasCaptureOne(emu, newFrame - emu.recordingStartFrame);
            }
        }
        window.CiteState.canvasCaptureTimer = requestAnimationFrame(window.CiteState.canvasCaptureTimerFn);
    };

    //the loaded emulator instance will implement saveState(cb), saveExtraFiles(cb), and loadState(s,cb)
    window.CiteState.cite = function (targetID, onLoad, gameFile, freezeFile, otherFiles, options) {
        var system = determineSystem(gameFile);
        var emulator = EmulatorNames[system];
        if (!(emulator in LoadedEmulators)) {
            var script = window.CiteState.scriptRoot+"emulators/" + emulator + ".js";
            //load the script on the page
            var scriptElement = document.createElement("script");
            scriptElement.src = script;
            scriptElement.onload = function () {
                LoadedEmulators[emulator] = window[emulator];
                realCite(targetID, onLoad, system, emulator, gameFile, freezeFile, otherFiles, options);
            };
            document.body.appendChild(scriptElement);
        } else {
            realCite(targetID, onLoad, system, emulator, gameFile, freezeFile, otherFiles, options);
        }
    }
})();


