 
var canvas = document.getElementById("blue"),
	objects = document.getElementById("objects"),
	context = canvas.getContext("2d"),
	palette = [
		"0,0,200,.75", // blue
		"50,50,250,.60", // light blue
		"0,0,150,.75", // dark blue
		"250,250,0,.60", // yellow
		"0,200,0,.75", // green
		"200,0,0,.80", // red
		"35,35,65,.85", // black
		"200,130,0,.80" // orange
	],
	ghostColor = "190,255,70,.5",
	pens = {
		// used for system elements
		paper: {
			color: "255,250,220"
		},
		lines: {
			color: "205,190,130"
		},
		blue: {
			color: "0,0,200"
		},
		yellow: {
			color: "250,250,0"
		},
		black: {
			color: "0, 0, 0" // used for hovering
		},
		gray: {
			color: "128, 128, 128" // used for unselected objects
		}
	}, kindDefaults = {
		fixed: false,
		floating: false,
		highSlopes: false,
		upThrough: false,
		vapor: false,
		attack: false,
		climb: false,
		swim: false,
		ctrl: ""
	},
	width = canvas.width,
	height = canvas.height,
	paletteSize = 5, selectedColor = 0,
	gridSize = 8,
	sectorSize = 100,
	paused = false,
	focused = true,
	editing = false,
	blinkState = 0,
	timerAccumulator = 0,
	frameStamp = 0, // used to keep from double-activating objects when they cross sector boundaries
	kinds, spawns,
	hoveredSpawn = null, // object the mouse is hovering over
	selectedSpawn = null, // selected object to edit
	selection = {
		rect: null, // [x1, y1, x2, y2], used for selecting parts of objects
		cells: { },
		kind: null // used for highlighting selected cells
	}
	
	terminalVelocity = 1.5,
	gravity = .06,

	sectors = { }, 

	obs = [ ], // active objects
	camera = {
		x: 0, y: 0,
		width: 0, height: 0, // updated when the graph paper is drawn
		tracking: null,
		trackBox: {
			x1: 0, y1: 0, x2: 0, y2: 0
		}
	},
	controller = resetController(),
	keymap = {
		game: {
			// arrows
			"38": "up",
			"37": "left",
			"40": "down",
			"39": "right",
			"12": "down", // numpad 5

			// wasd
			"87": "up",
			"65": "left",
			"83": "down",
			"68": "right",

			// hjkl
			"72": "left",
			"74": "down",
			"75": "up",
			"76": "right",

			// space
			"32": "jump",

			// tilde
			"192": "pause",

			// escape
			"27": "cancel"
		},
		editor: {
			// tilde
			"192": "pause",

			"49": "export-save",
			"50": "storage-save",
			"48": "storage-load",

			"78": "new-spawn",
			"82": "reset-spawn",

			"8": "split-selection",
			"46": "delete-selection",
			"13": "recolor-selection",

			// escape
			"27": "cancel"
		}
	}, dirs = {
		up: {x: 0, y: -1},
		right: {x: 1, y: 0},
		left: {x: -1, y: 0},	
		down: {x: 0, y: 1}
	};

var modifierNames = {
	"16": {
		name: "shift",
		left: "lshift",
		right: "rshift"
	},
	"17": {
		name: "ctrl",
		left: "lctrl",
		right: "rctrl"
	},
	"18": {
		name: "alt",
		left: "lalt",
		right: "ralt"
	}
}

loadLevel(JSON.parse(localStorage.save || window.defaultSave));

partitionSpawnsIntoSectors(spawns);
kickstart();

document.addEventListener("keydown", keyDown);
document.addEventListener("keyup", keyUp);
document.addEventListener("mousedown", mouseDown);
document.addEventListener("mousemove", mouseMove);
document.addEventListener("mouseup", mouseUp);
document.addEventListener("contextmenu", function (e) {e.preventDefault();});
// window.addEventListener("gamepadconnected", function(e) { gamepadHandler(e, true); }, false);
// window.addEventListener("gamepaddisconnected", function(e) { gamepadHandler(e, false); }, false);


activateJsonEditor();

window.onfocus = gainFocus;
window.onblur = loseFocus;

function graphPaperGrid() {
	context.globalCompositeOperation = "source-over";

	context.fillStyle = "rgb(" + pens.paper.color + ")";
	context.fillRect(0,0,width,height);

	context.fillStyle = "rgb(" + pens.lines.color + ")";

	camera.width = Math.floor(width / gridSize);
	camera.height = Math.floor(height / gridSize);
	camera.trackBox.x1 = Math.floor(camera.width / 3);
	camera.trackBox.x2 = Math.floor(2 * camera.width / 3);
	camera.trackBox.y1 = Math.floor(camera.width / 3);
	camera.trackBox.y2 = Math.floor(2 * camera.height / 3);

	for (var x = 0; x < camera.width; x++) {
		var px = x * gridSize;
		fifth = (x % 5 === 0) ? 2 : 1;
		context.fillRect(px, 0, fifth, height);
	}	
	for (var y = 0; y < camera.height; y++) {
		var py = y * gridSize;
		fifth = (y % 5 === 0) ? 2 : 1;
		context.fillRect(0, py, width, fifth);
	}
}

function kickstart() {
	window.requestAnimationFrame(frame);
}

var oldTime = 0, timeAcc = 0;
function frame(time) {
	if (!focused) {
		window.requestAnimationFrame(frame);
		return;
	}

	var startTime = performance.now();

	if (oldTime) {
		timeAcc += time - oldTime;
	}	
	oldTime = time;

	updateController();
	blinkState = time % 500 < 250 ? 0 : 1;
	
	while (timeAcc > 1000/60) {
		if (!paused) update();
		timeAcc -= 1000/60;
	}
	render();

	window.requestAnimationFrame(frame);

	var endTime = performance.now();
	document.getElementById("frame-time").innerHTML = Math.floor(endTime - oldTime);


	function update() {
		frameStamp++;
		touchSpawnsInCellRect(spawns, frameStamp, camera.x, camera.y, camera.x + camera.width - 1, camera.y + camera.height - 1);

		forActiveObjects(frameStamp, true, function(ob) {
			// forActiveObjects also removes objects that have been invisible too long
			var overlaps = { };

			overlaps[ob.name] = true;

			if (!ob.kind.fixed && !ob.kind.floating) {
				poke(overlaps, ob.x, ob.y, ob.kind, addOverlap);

				gravitate(ob);
			}

			if (ob.kind.ctrl === "player") {
				playerCommand(ob);
			}

			if (ob.kind.ctrl === "bouncy") {
				bouncyCommand(ob);
			}

			ob.subX += ob.xv;
			ob.subY += ob.yv;
			bump(ob, overlaps);

			function addOverlap(it) {
				overlaps[it.name] = true;
			}
		});

		if (camera.tracking) {
			var
				trackX = camera.tracking.x - camera.x,
				trackY = camera.tracking.y - camera.y;

			if (trackX < camera.trackBox.x1) trackX = camera.trackBox.x1;
			if (trackX > camera.trackBox.x2) trackX = camera.trackBox.x2;
			if (trackY < camera.trackBox.y1) trackY = camera.trackBox.y1;
			if (trackY > camera.trackBox.y2) trackY = camera.trackBox.y2;

			camera.x = camera.tracking.x - trackX;
			camera.y = camera.tracking.y - trackY;
		}
	}

	function bump(ob, ignore) {
		// move the grid-object one cell in one direction when the exact position crosses a grid line
		// 1. objects first move horizontally and then vertically, to make it easier to run over holes
		// 2. yes, objects move one at a time, we'll see if any issues come up that sort-order and pushing can't fix
		// 3. yes, I want Arthur to understand what's going on here, so it's a little repetitive
		
		var subX = ob.subX, subY = ob.subY;

		// todo: rewrite slope logic so it works for all corner pieces in all directions
		// also: make sure diagonals don't trap you

		while (subX > 0) {
			var slope = false;
			if (blocked(ob.x + 1, ob.y)) {
				// check for a slope
				if (!blocked(ob.x + 1, ob.y - 1)) {
					slope = true;
				} else {
					subX = 0;
					ob.xv = 0;
					break;
				}
			}
			if (subX >= 1) {
				ob.x++; // don't advance the object visibly until it's supposed to move a full cell right
				subX--;

				if (slope) {
					ob.y--;
					ob.subY++;
				}
			} else break;
		}

		while (subX < 0) {
			if (blocked(ob.x - 1, ob.y)) {
				// check for a slope
				if (!blocked(ob.x - 1, ob.y - 1)) {
					ob.y--;
					ob.subY++;
				} else {
					subX = 0;
					ob.xv = 0;
					break;
				}
			}
			ob.x--;
			subX++;
		}

		while (subY > 0) {
			if (blocked(ob.x, ob.y + 1)) {
				subY = 0;
				ob.standStamp = frameStamp;
				ob.yv = 0;
				break;
			}
			if (subY >= 1) {
				ob.y++;
				subY--;
			} else break;
		}

		while (subY < 0) {
			if (blocked(ob.x, ob.y - 1, true)) {
				// slide left or right?
				if (!blocked(ob.x - 1, ob.y - 1)) {
					ob.x--;
				} else if (!blocked(ob.x + 1, ob.y - 1)) {
					ob.x++;
				} else {
					subY = 0;
					ob.yv = 0;
					break;
				}
			}
			ob.y--;
			subY++;
		}

		ob.subX = subX;
		ob.subY = subY;

		return;

		function blocked(x, y, up) {
			return poke(ignore, x, y, ob.kind, cb);

			function cb(it) {
				return !it.vapor && !(up && it.kind.upThrough);
			}
		}
	}

	function render() {
		graphPaperGrid();

		context.globalCompositeOperation = "multiply";

		if (editing) {
			var visitedSpawns = { }; // multiple sectors can contain the same spawn

			forSectorsInCellRect(camera.x, camera.y, camera.x + camera.width, camera.y + camera.height, function(sector) {
				var spawns = sector.spawns;
				for (var k in spawns) {
					var spawn = spawns[k], kind = kinds[spawn.kindName], overrideColor = null;

					if (!visitedSpawns[spawn.spawnName]) {
						if (spawn !== selectedSpawn)
							overrideColor = pens.gray.color;
						if (spawn === hoveredSpawn && spawn !== selectedSpawn)
							overrideColor = null;

						fillKind(kind, spawn.x - camera.x, spawn.y - camera.y, overrideColor);
						drawAnchors(spawn.x - camera.x, spawn.y - camera.y, kind.anchors);
						visitedSpawns[spawn.spawnName] = true;
					}
				}
			});

			if (hoveredSpawn) {
				var kind = kinds[hoveredSpawn.kindName];
				outlineRect(
					hoveredSpawn.x + kind.x1 - camera.x,
					hoveredSpawn.y + kind.y1 - camera.y,

					hoveredSpawn.x + kind.x2 - camera.x,
					hoveredSpawn.y + kind.y2 - camera.y,

					pens.blue.color
				);
			}
			if (selectedSpawn) {
				var kind = kinds[selectedSpawn.kindName];
				outlineRect(
					selectedSpawn.x + kind.x1 - camera.x,
					selectedSpawn.y + kind.y1 - camera.y,

					selectedSpawn.x + kind.x2 - camera.x,
					selectedSpawn.y + kind.y2 - camera.y,

					pens.yellow.color
				);
			}

			if (selection.rect) {
				outlineRect(selection.rect[0], selection.rect[1], selection.rect[2], selection.rect[3], pens.blue.color);
			}

			if (selectedSpawn) {
				fillSelectedCells();
			}

			for (var i=0; i<obs.length; i++) {
				var ob = obs[i];

				if (ob.spawn.x != ob.x || ob.spawn.y != ob.y)
					fillKind(ob.kind, ob.x - camera.x, ob.y - camera.y, ghostColor);
			}

			drawPalette();
		} else {
			for (var i=0; i<obs.length; i++) {
				var ob = obs[i];

				fillKind(ob.kind, ob.x - camera.x, ob.y - camera.y);
			}
		}

		context.globalCompositeOperation = "source-over";

		if (editing) {
			outlineCell(controller.mx, controller.my, blinkState ? pens.blue.color : pens.yellow.color);
		}
	}
}

function poke(ignore, x, y, kind, cb) {
	var found = false;

	// 1. activate overlapping spawns, just in case
	touchSpawnsInCellRect(x + kind.x1, y + kind.y1, x + kind.x2, y + kind.y2);
	forObjectsInCellRect(x + kind.x1, y + kind.y1, x + kind.x2, y + kind.y2, function(it) {
		if (found || ignore[it.name]) return;
		for (var cellIndex in kind.cells) {
			var cell = kind.cells[cellIndex];
			var itsCell = it.kind.cells[(x - it.x + cell.x) + "," + (y - it.y + cell.y)]; // yeah it's indexed by strings, it's javascript

			if (itsCell && cb(it)) {
				// the callback returns true if we should short-circuit
				found = true;
				return;
			}
		}
	});

	return found;
}

function gravitate(ob) {
	ob.yv += gravity;
	if (ob.yv > terminalVelocity) ob.yv = terminalVelocity;
}

function accelerateTowards(x, dx, tx) {
	if (tx < x) {
		return Math.max(x - dx, tx);
	} else {
		return Math.min(x + dx, tx);
	}
}

function drawPalette() {
	context.globalCompositeOperation = "multiply";
	for (var i = 0; i < palette.length; i++) {
		var x1 = 0, y1 = paletteSize * i * gridSize;

		context.fillStyle = "rgba(" + palette[i] + ")";
		context.fillRect(x1, y1, gridSize * paletteSize, gridSize * paletteSize);
	}


	context.globalCompositeOperation = "source-over";
	context.strokeStyle = "rgb(255, 255, 255)";
	context.lineWidth = 2;
	context.strokeRect(x1, paletteSize * selectedColor * gridSize, gridSize * paletteSize, gridSize * paletteSize);
}

function clickPalette(x, y) {
	if (x < paletteSize) {
		var i = Math.floor(y / paletteSize);

		if (palette[i]) return i;
	}
}

function getMirror(kind) {
	// we can add flipping upside-down if we want, but really we don't need it
	if (kind.mirror) return kind.mirror;

	var
		mirror = { },
		cells = kind.cells,
		newCells = { },
		atx = kind.anchors.at.x,
		aty = kind.anchors.at.y;

	// start by copying
	for (var k in kind) {
		mirror[k] = kind[k];
	}

	mirror.cells = newCells;

	for (var k in cells) {
		var cell = cells[k], x = atx - cell.x, y = cell.y;
		newCells[x + "," + y] = {
			x: x,
			y: y,
			color: cell.color
		}
	}

	kind.mirror = mirror;
	mirror.mirror = kind;
}

function playerCommand(ob) {
	var
		speed = 1, acceleration = .1, airacc = .05;

	if (frameStamp - ob.standStamp < 2) {
		// we're basically on the ground
		ob.xv = accelerateTowards(ob.xv, acceleration, speed * controller.dx);
	} else {
		// we're in midair: allow hooks but ignore dx == 0
		ob.xv += controller.dx * airacc;
		if (ob.xv < -speed) ob.xv = -speed;
		if (ob.xv > speed) ob.xv = speed;
	}

	// have to rethink flipping, since it breaks cell-perfect collisions
	// if (controller.dx < -.5) ob.flipped = true;
	// if (controller.dx > .5) ob.flipped = false;

	// 1. also need to account for the object's ability to jump in midair
	// 2. also need to allow the object to jump down

	if (ob.kind.jump) {
		var jump = ob.kind.jump;

		if (controller.jump === frameStamp - 1 && (frameStamp - ob.standStamp < jump.laxFrames)) {
			if (controller.dy > .5) {
				ob.y++; // hackish way to jump down -- just for testing -- actually probably just add down-neighbor to overlaps
				ob.yv = jump.speed;
			} else {
				ob.yv = -jump.speed;
				ob.jumpTime = ob.kind.jump.time;
			}
		}

		if (controller.jump && ob.jumpTime > 0) {
			ob.jumpTime--;
			ob.yv = -jump.speed;
		}

		if (!controller.jump && ob.yv < jump.capSpeed) {
			ob.yv = jump.capSpeed;
			ob.jumpTime = 0;
		}
	}

	camera.tracking = ob;
}

function bouncyCommand(ob) {
	var acceleration = .01, speed = .4;

	if (!ob.heading) ob.heading = -1;

	// well if this ain't a hack a minute
	
	if (ob.xv === 0) {
		ob.heading = -ob.heading;
	}

	ob.xv = accelerateTowards(ob.xv, acceleration, speed * ob.heading);
}

function spawnGuy(spawnName, spawn, frameStamp) {
	var
		kind = kinds[spawn.kindName],
		directives = kind.directives,
		guy = {
			name: spawnName,
			frameStamp: 0,
			spawn: spawn, // used to despawn/kill
			lastSeen: 0, // used to despawn
			x: Math.floor(spawn.x), y: Math.floor(spawn.y),
			subX: 0, subY: 0,
			xv: spawn.xv, yv: spawn.yv,

			kind: kind
		};

	for (var k in spawn) {
		if (!guy.hasOwnProperty(k)) guy[k] = spawn[k];
	}

	return guy;
}

function fillKind(kind, x, y, overrideColor) {
	var cells = kind.cells;

	for (var k in cells) {
		var cell = cells[k];
 		fillCell(x + cell.x, y + cell.y, overrideColor || palette[cell.color]);
	}
}

function fillSelectedCells( ) {
	var kind = kinds[selectedSpawn.kindName],
		cells = selection.cells, cell, x, y;

	context.strokeStyle = "rgba(255, 255, 255)";
	context.globalCompositeOperation = "source-over";
	context.lineWidth = 2;

	for (var k in cells) {
		cell = cells[k];
		x = cell.x + selectedSpawn.x - camera.x;
		y = cell.y + selectedSpawn.y - camera.y;
		context.strokeRect(x * gridSize + 1, y * gridSize + 1, gridSize - 1, gridSize - 1);
	}
}

function fillCell(x, y, color) {
	context.fillStyle = "rgba(" + color + ")";
	context.fillRect(x * gridSize + 1, y * gridSize + 1, gridSize, gridSize);
}

function drawAnchors(x, y, anchors) {
	context.font = '10px monospace';
	context.fillStyle = "rgba(255, 255, 255, 1)";
	for (var anchorName in anchors) {
		var anchor = anchors[anchorName];
		context.fillText('@', (x + anchor.x) * gridSize + 1, (1 + y + anchor.y) * gridSize);
 	}
}

function outlineCell(x, y, color) {
	context.strokeStyle = "rgba(" + color + ")";
	context.lineWidth = 2;
	context.strokeRect(x * gridSize + 1, y * gridSize + 1, gridSize, gridSize);
}

function outlineRect(x1, y1, x2, y2, color) {
	// it is necessary to swap, not because strokeRect cares (it does not), but because we add 1 to the width
	var swap;
	if (x2 < x1) { swap = x2; x2 = x1; x1 = swap; }
	if (y2 < y1) { swap = y2; y2 = y1; y1 = swap; }

	context.strokeStyle = "rgba(" + color + ")";
	context.lineWidth = 2;
	context.strokeRect(
		x1 * gridSize + 1,
		y1 * gridSize + 1,
		(x2 - x1 + 1) * gridSize,
		(y2 - y1 + 1) * gridSize
	);
}

function inEditor(t) {
	while (t) {
		if (t.id === "editor") return true;
		t = t.parentElement;
	}
}

function keyDown(e) {
 	var
 		cmd = keymap[editing ? "editor" : "game"][e.keyCode],
 		modifier = modifierNames[e.keyCode];

 	// unfocus any element on esc:
 	if (e.keyCode === 27 && document.activeElement.tagName !== "BODY") {
 		document.activeElement.blur();
 	}

	// modifiers
	if (modifier) {
		controller.modifiers[modifier.name] = true;
		if (e.location === KeyboardEvent.DOM_KEY_LOCATION_LEFT)
				controller.modifiers[modifier.lname] = true;
		if (e.location === KeyboardEvent.DOM_KEY_LOCATION_RIGHT)
			controller.modifiers[modifier.rname] = true;
	}

 	// system keymaps
	if (cmd) {
		if (inEditor(e.target)) return;
		
		e.preventDefault();

		if (!controller.keys[e.keyCode]) { // suppress repeat
			if (cmd === "pause") {
				// this is elaborate but it works, maybe simplify it?
				selectSpawn(null);
				hoveredSpawn = null;
				
				if (editing) {
					paused = false;
					editing = false;
				} else if (controller.modifiers.shift) {
					paused = true;
					editing = true;
				} else if (paused) {
					paused = false;
					editing = false;
				} else {
					paused = true;
				}

				document.getElementById("editor").style.display = editing ? "block" : "none";
			}
			if (cmd === "cancel") {
				if (selectedSpawn) {
					selectSpawn(null)
				} else {
					paused = false;
					editing = false;

					document.getElementById("editor").style.display = editing ? "block" : "none";
				}
			}
			if (cmd === "export-save") {
				navigator.clipboard.writeText(JSON.stringify(saveLevel( ), null, "\t"));
			}
			if (cmd === "storage-save") {
				localStorage.save = JSON.stringify(saveLevel( ));
			}
			if (cmd === "storage-load") {
				loadLevel(JSON.parse(localStorage.save));
			}

			if (cmd === "new-spawn") {
				selectSpawn(null);
			}

			if (cmd === "reset-spawn") {
				if (selectedSpawn) {
					resetSpawn(selectedSpawn);
				}
			}

			if (cmd === "delete-selection") {
				if (selectedSpawn) {
					var kind = kinds[selectedSpawn.kindName];
					for (var idx in selection.cells) {
						delete kind.cells[idx];
					}

					// use wipeFromKind to recompute spawn bounds -- an invalid index is no problem there
					wipeFromKind(kind, "-", "-");
					
					selection.cells = { };
				}
			}

			if (cmd === "recolor-selection") {
				if (selectedSpawn) {
					var kind = kinds[selectedSpawn.kindName];
					for (var idx in selection.cells) {
						kind.cells[idx].color = selectedColor;
					}

					selection.cells = { };
				}
			}

			if (cmd === "split-selection") {
				if (selectedSpawn) {
					// are there any selected cells?
					var cells = selection.cells, firstCell = null;

					for (var cell in cells) {
						firstCell = selection.cells[cell];
						break;
					}

					if (firstCell) {
						var kind = kinds[selectedSpawn.kindName], newKind;

						// now make a fresh spawn at the location of the first cell
						selectSpawn(freshSpawn(firstCell.x + selectedSpawn.x, firstCell.y + selectedSpawn.y))
						newKind = kinds[selectedSpawn.kindName];

						for (var idx in cells) {
							var cell = cells[idx];
							drawOnKind(newKind, cell.x - firstCell.x, cell.y - firstCell.y, cell.color);
							delete kind.cells[idx];
						}

						// use wipeFromKind to recompute spawn bounds -- an invalid index is no problem there
						wipeFromKind(kind, "-", "-");
					}
				}
			}
		}
	}

	controller.keys[e.keyCode] = true;

 	console.log(e.keyCode);
}

function keyUp(e) {
 	var
 		cmd = keymap[e.keyCode],
 	 	modifier = modifierNames[e.keyCode];

	// modifiers
	if (modifier) {
		if (e.location === KeyboardEvent.DOM_KEY_LOCATION_LEFT)
				controller.modifiers[modifier.lname] = false;
		if (e.location === KeyboardEvent.DOM_KEY_LOCATION_RIGHT)
			controller.modifiers[modifier.rname] = false;

		// the base name is still true, though, if the other instance of the key is being held
		controller.modifiers[modifier.name] = controller.modifiers[modifier.lname] || controller.modifiers[modifier.rname];
	}

	// wipe the key
 	delete controller.keys[e.keyCode];

	if (cmd) e.preventDefault();
}

function updateController() {
	var holdingJump = false;
	// wipe
	controller.dx = 0;
	controller.dy = 0;
	
	// gamepads
	var pads = (navigator.getGamepads && navigator.getGamepads()) || navigator.webkitGetGamepads;
	for (var i = 0; pads && i < pads.length; i++) {
		var pad = pads[i];
		/*if (gp) {
		  gamepadInfo.innerHTML = "Gamepad connected at index " + gp.index + ": " + gp.id +
		    ". It has " + gp.buttons.length + " buttons and " + gp.axes.length + " axes.";
		  gameLoop();
		  clearInterval(interval);
		}*/
		//if (gp) {
		//	console.log(gp.buttons.join(","));
		//}
		if (pad) {
			var buttons = pad.buttons, axes = pad.axes;
			// x a b y l r ? ? start select

			if (pressed(buttons, 2) || pressed(buttons, 1)) holdingJump = true;
			controller.dx += axes[0];
			controller.dy += axes[1];
		}
	}


	// keyboard
	for (var k in controller.keys) {
		var cmd = keymap.game[k];

		if (dirs[cmd]) {
			controller.dx += dirs[cmd].x;
			controller.dy += dirs[cmd].y;
		}
		if (cmd == "jump") holdingJump = true;
	}

	// clip controller
	if (controller.dx < -1) controller.dx = -1;
	if (controller.dx > 1) controller.dx = 1;
	if (controller.dy < -1) controller.dy = -1;
	if (controller.dy > 1) controller.dy = 1;

	if (holdingJump && controller.jump === 0) controller.jump = frameStamp;
	if (!holdingJump) controller.jump = 0; // this is a frameStamp

	function pressed(buttons, idx) {
		return buttons[idx] && buttons[idx].pressed;
	}
}




// utility functions that keep the json editor in sync automatically

function activateJsonEditor() {
	var box = document.getElementById("kind-box"),
		editObject = null, currentValue = null,
		errorBox = document.getElementById("kind-box-error"),
		oldBoxValue = "", editObject = null, interval = null, saveCallback;

	box.addEventListener("focus", onfocus);
	box.addEventListener("blur", onblur);

	window.liveEditObject = liveEditObject;


	var lastValue = null;
	function jsonUpdate( ) {
		try {
			if (lastValue != box.value) {
				currentValue = JSON.parse(box.value);
				errorBox.innerHTML = "";
				if (saveCallback) saveCallback(currentValue);
			}
		} catch (e) {
			errorBox.innerHTML = e;
		}
	}

	function liveEditObject(object, cb) {
		editObject = object;
		saveCallback = cb;
		if (object) {
			box.value = JSON.stringify(object, null, " ");
			lastValue = box.value;
			jsonUpdate( );
		} else {
			box.value = "";
		}
	}

	function onfocus() {
		interval = window.setInterval(jsonUpdate, 100);
	}
	function onblur() {
		window.clearInterval(interval);
		interval = null;
	}
}



function topWidget(x, y) {
	for (var i = 0; i < widgets.length; i++) {
		var widget = widgets[i];
		if (inRect(x, y, widget.x, widget.y, widget.width, widget.height)) {

		}		
	}
}

function inRect(x, y, rx, ry, rw, rh) {
	return rx <= x && ry <= y && rx + rw >= x && ry + rh >= y;
}

function objectAt(px, py) {
	for (var i = 0; i < obs.length; i++) {
		var
			ob = obs[i],
			x = px - ob.x,
			y = py - ob.y;

		// test bounds
		if (x < ob.kind.x1 || x > ob.kind.x2 || y < ob.kind.y1 || y > ob.kind.y2)
			continue;
		
		if (ob.kind.cells[x + "," + y])
			return ob;
	}
}

function spawnAt(px, py) {
	var found = null;
	forSectorsInCellRect(px, py, px, py, function(sector) {
		var spawns = sector.spawns;
		for (var k in spawns) {
			var
				spawn = spawns[k],
				kind = kinds[spawn.kindName],
				x = px - spawn.x,
				y = py - spawn.y;
			
			if (x < kind.x1 || x > kind.x2 || y < kind.y1 || y > kind.y2)
				continue;
			
			if (kind.cells[x + "," + y]) {
				found = spawn;
				return;
			}
		}
	});

	return found;
}

function mouseDown(e) {
	var
		button = e.which ? e.which - 1 : e.button,
		x = Math.floor(e.clientX / gridSize),
		y = Math.floor(e.clientY / gridSize);
	
	controller.buttons[button] = true;

	if (inEditor(e.target)) return;

	paint(controller);

	e.preventDefault();
}

function mouseMove(e) {
	var
		x = Math.floor((e.pageX - canvas.offsetTop) / gridSize),
		y = Math.floor((e.pageY - canvas.offsetLeft) / gridSize);

	if (inEditor(e.target)) return;

	document.getElementById("mouse-position").innerHTML = x + ", " + y;
	
	if (x != controller.mx || y != controller.my) {
		controller.mdx = x - controller.mx;
		controller.mdy = y - controller.my;

		controller.mx = x;
		controller.my = y;

		paint(controller, 0, 0);

		controller.mdx = 0;
		controller.mdy = 0;
	}

	e.preventDefault();
}

function mouseUp(e) {
	var
		button = e.which ? e.which - 1 : e.button;

	controller.buttons[button] = false;

	if (inEditor(e.target)) return;

	paint(controller, 0, 2);

	e.preventDefault();
}

function paint(controller) {
	var
		x = controller.mx, y = controller.my;

	if (controller.buttons[2] && controller.modifiers.shift) {
		camera.x -= controller.mdx;
		camera.y -= controller.mdy;

		// this is not where this belongs
		document.getElementById("camera-position").innerHTML = camera.x + ", " + camera.y;
	}

	
	if (editing) {
		// click the palette?
		if (controller.buttons[0]) {
			var paletteIndex = clickPalette(x, y);
			if (paletteIndex !== undefined) {
				selectedColor = paletteIndex;
				return;
			}
		}

		var spawn = spawnAt(x + camera.x, y + camera.y);

		 if (selectedSpawn && controller.buttons[0] && controller.modifiers.shift) {
			if (selection.rect) {
				selection.rect[2] = x;
				selection.rect[3] = y;
			} else {
				selection.rect = [x, y, x, y];
			}

			return;
		}

		if (selection.rect && !(controller.buttons[0] && controller.modifiers.shift)) {
			toggleCellsInSelectionRect();
			selection.rect = null;
			return;
		}

		if (selectedSpawn && hoveredSpawn === selectedSpawn && controller.buttons[0] && controller.modifiers.ctrl) {
			// drag the selected object?
			moveSpawn(selectedSpawn, selectedSpawn.x + controller.mdx, selectedSpawn.y + controller.mdy);
		} else {
			hoveredSpawn = spawn;

			if (hoveredSpawn && hoveredSpawn !== selectedSpawn) {
				// we're hovering over a different object than the selected one
				if (controller.buttons[0] && controller.mdx === 0 && controller.mdy === 0) {
					// select the spawn we're hovering over, and return so we don't draw on it yet
					selectSpawn(spawn);
					return;
				}
			}

			if (!controller.modifiers.shift) {
				if (selectedSpawn && controller.buttons[0]) {
					// draw on the selected object's kind: we need coordinates relative to the object
					var
						obx = controller.mx + camera.x - selectedSpawn.x,
						oby = controller.my + camera.y - selectedSpawn.y;

					// addDirective(selectedObject.kind, obx, oby, "draw blue");
					// addDirective(selectedObject.kind, obx, oby, "body stop");

					if (controller.mdx === 0 && controller.mdy === 0) {
						drawOnKind(kinds[selectedSpawn.kindName], obx, oby, selectedColor);
					} else {
						// taxicab it: this code is terrible but I wanted to finish it in five minutes
						for (var dx = 0; dx != controller.mdx; dx += Math.sign(controller.mdx)) {
							drawOnKind(kinds[selectedSpawn.kindName], obx - dx, oby, selectedColor);
						}

						for (var dy = 0; dy != controller.mdy; dy += Math.sign(controller.mdy)) {
							drawOnKind(kinds[selectedSpawn.kindName], obx - dx, oby - dy, selectedColor);
						}
					}
					
				}

				if (selectedSpawn && controller.buttons[2]) {
					// draw on the selected object's kind: we need coordinates relative to the object
					var
						obx = controller.mx + camera.x - selectedSpawn.x,
						oby = controller.my + camera.y - selectedSpawn.y;

					//removeDirectives(selectedObject.kind, obx, oby);
					wipeFromKind(kinds[selectedSpawn.kindName], obx, oby);
				}

				if (!selectedSpawn && controller.buttons[0]) {
					// double check that there isn't anything here, but let's draw a new object:
					if (!spawnAt(controller.mx + camera.x, controller.my + camera.y)) {
						selectSpawn(freshSpawn(controller.mx + camera.x, controller.my + camera.y));
					}
				}
			}
		}
	}

	// whether we're editing or not -- select via an already spawned object?
	if (controller.modifiers.shift && controller.buttons[0] && !selectedSpawn) {
		var ob = objectAt(x + camera.x, y + camera.y)
		
		if (ob) {
			paused = true;
			editing = true;
			document.getElementById("editor").style.display = editing ? "block" : "none";
			selectSpawn(ob.spawn);
		}
	}
}

function toggleCellsInSelectionRect() {
	var kind = kinds[selectedSpawn.kindName],
		x1 = selection.rect[0] + camera.x - selectedSpawn.x,
		y1 = selection.rect[1] + camera.y - selectedSpawn.y,
		x2 = selection.rect[2] + camera.x - selectedSpawn.x,
		y2 = selection.rect[3] + camera.y - selectedSpawn.y,
		swap;
	
	if (x2 < x1) { swap = x2; x2 = x1; x1 = swap; }
	if (y2 < y1) { swap = y2; y2 = y1; y1 = swap; }

	for (var k in kind.cells) {
		var cell = kind.cells[k];
		if (cell.x >= x1 && cell.x <= x2 && cell.y >= y1 && cell.y <= y2) {
			if (selection.cells[k]) delete selection.cells[k];
			else selection.cells[k] = cell;
		}
	}
}

function freshSpawn(x, y) {
	var nameBase = "map-part-", spawnName,
		kind = {
			anchors: {at: {x: 0, y: 0}},
			cells: { },
			x1: 0, y1: 0, x2: 0, y2: 0,
			fixed: true
		},
		spawn = {
			x: x,
			y: y,
			xv: 0,
			yv: 0,
			state: { }
		};

	drawOnKind(kind, 0, 0, selectedColor);

	for (var i = 1; ; i++) {
		spawnName = nameBase + i;
		if (!spawns[spawnName] && !kinds[spawnName]) {
			// use the same name for the kind and the spawn
			kind.kindName = spawnName;
			spawn.spawnName = spawnName;
			spawn.kindName = spawnName;

			spawns[spawnName] = spawn;
			kinds[spawnName] = kind;

			forSectorsInCellRect(x, y, x, y, function(sector) {
				sector.spawns[spawnName] = spawn;
			});
			
			return spawn;
		}
	}
}

function resetSpawn(spawn) {
	spawn.state.ob = null;
	for (var i = obs.length - 1; i >= 0; i--) {
		if (obs[i].spawnName === spawn.spawnName) {
			obs.splice(i, 1);
		}
	}

	// touch the spawn in case it's off camera
	touchSpawn(spawn);
}

function selectSpawn(spawn) {
	if (selectedSpawn !== spawn) {
		selection.cells = { };

		if (spawn) {
			var copyKind = { }, exclude = {
				cells: true,
				anchors: true,
				x1: true,
				x2: true,
				y1: true,
				y2: true
			}, kind = kinds[spawn.kindName];

			for (var k in kind) {
				if (!exclude[k]) copyKind[k] = kind[k];
			}

			for (var k in kindDefaults) {
				if (!copyKind.hasOwnProperty(k)) copyKind[k] = kindDefaults[k];
			}

			liveEditObject(copyKind, onSave);
		} else {
			liveEditObject(null);
		}
	}

	selectedSpawn = spawn;

	function onSave(edited) {
		/* copy newValues over object, but delete defaults */
		for (var k in edited) {
			kind[k] = edited[k];
		}
	}
}

function ensureCameraSpawn(spawn) {
	var kind = kinds[spawn.kindName];
	ensureCamera(
		spawn.x + Math.floor((kind.x1 + kind.x2) / 2),
		spawn.y + Math.floor((kind.y1 + kind.y2) / 2)
	);
}

function ensureCamera(x, y) {
	if (!(camera.x <= x && camera.y <= y && camera.x + camera.width > x && camera.y + camera.height > y)) {
		camera.x = Math.floor(x - camera.width / 2);
		camera.y = Math.floor(y - camera.height / 2);
	}
}

function moveSpawn(spawn, x, y) {
	var kind = kinds[spawn.kindName];
	forSectorsInCellRect(spawn.x + kind.x1, spawn.y + kind.y1, spawn.x + kind.x2, spawn.y + kind.y2, function (sector) {
		delete sector.spawns[spawn.spawnName];
	});

	forSectorsInCellRect(x + kind.x1, y + kind.y1, x + kind.x2, y + kind.y2, function (sector) {
		sector.spawns[spawn.spawnName] = spawn;
	});

	spawn.x = x;
	spawn.y = y;
}

function rgbToCmyk(rgbString) {
	var
		rgb = rgbString.split(","),
		r = rgb[0] / 256,
		g = rgb[1] / 256,
		b = rgb[2] / 256,
		k = 1 - Math.max(r, g, b),
		c = (1 - r - k) / (1 - k),
		m = (1 - g - k) / (1 - k),
		y = (1 - b - k) / (1 - k);

	return [c, m, y, k];
}

function cmykToRgb(cmyk) {
	var
		r = Math.floor(255 * (1-cmyk[0]) * (1-cmyk[3])),
		g = Math.floor(255 * (1-cmyk[1]) * (1-cmyk[3])),
		b = Math.floor(255 * (1-cmyk[2]) * (1-cmyk[3]));

	return r + "," + g + "," + b;
}

function cmykBlend(a, b) {
	// broken right now
	var
		oldCmyk = rgbToCmyk(cell.color),
		newCmyk = rgbToCmyk(rgbString),
		c = oldCmyk[0] + hardness * newCmyk[0],
		m = oldCmyk[1] + hardness * newCmyk[1],
		y = oldCmyk[2] + hardness * newCmyk[2],
		k = oldCmyk[3] + hardness * newCmyk[3];

	c = Math.min(1, c);
	m = Math.min(1, m);
	y = Math.min(1, y);
	k = Math.min(1, k);

	kind.cells[index].color = cmykToRgb([c, m, y, k]);
}

function rgbaBlend(a, b) {
	return [
		Math.exp((Math.log(a[0]) * a[3] + Math.log(b[0]) * b[3]) / (+a[3] + +b[3])),
		Math.exp((Math.log(a[1]) * a[3] + Math.log(b[1]) * b[3]) / (+a[3] + +b[3])),
		Math.exp((Math.log(a[2]) * a[3] + Math.log(b[2]) * b[3]) / (+a[3] + +b[3])),
		1 - (1 - a[3]) * (1 - b[3])
	];
}

function drawOnKind(kind, x, y, colorIndex) {
	var
		index = x + "," + y,
		cell = kind.cells[index];

	if (cell) {
		cell.color = colorIndex;
	} else {
		kind.cells[index] = {
			x: x,
			y: y,
			color: colorIndex
		}
		// update the bounding rectangle

		if (x < kind.x1) kind.x1 = x;
		if (y < kind.y1) kind.y1 = y;
		if (x > kind.x2) kind.x2 = x;
		if (y > kind.y2) kind.y2 = y;
	}
}

function wipeFromKind(kind, x, y) {
	delete kind.cells[x + "," + y];
	recomputeKindBounds(kind);
}

function recomputeKindBounds(kind) {
	// recompute the bounding rectangle
	var x1 = 0, y1 = 0, x2 = 0, y2 = 0; // always contain 0,0
	for (k in kind.cells) {
		var cell = kind.cells[k];
		if (cell.x < x1) x1 = cell.x;
		if (cell.y < y1) y1 = cell.y;
		if (cell.x > x2) x2 = cell.x;
		if (cell.y > y2) y2 = cell.y;
	}
	kind.x1 = x1;
	kind.x2 = x2;
	kind.y1 = y1;
	kind.y2 = y2;
}

function addDirective(kind, x, y, dir) {
	// update the bounding rectangle

	if (x < kind.x1) kind.x1 = x;
	if (y < kind.y1) kind.y1 = y;
	if (x > kind.x2) kind.x2 = x;
	if (y > kind.y2) kind.y2 = y;

	kind.directives.push(x + " " + y + " " + dir);
}

function removeDirectives(kind, x, y) {
	// we have to recompute the bounding rectangle now

	for (var i = 0; i < kind.directives.length; i++) {
		var
			directive = kind.directives[i],
			args = directive.split(" "),
			dx = +args[0], dy = +args[1];

		if (dx === x && dy === y) {
			kind.directives.splice(i, 1);
			i--;
		}
	}
}


function gainFocus() {
	focused = true;
}

function loseFocus() {
	resetController();

	oldTime = 0;
	timeAcc = 0;

	focused = false;
}

function resetController() {
	// this sets controller AND returns it, so the first appearance can be pretty
	return controller = {
		dx: 0, dy: 0, // keyboard/gamepad
		mx: 0, my: 0, // mouse
		mdx: 0, mdy: 0, // mouse delta
		commands: { },

		keys: { },
		buttons: [false, false, false],
		modifiers: {
			shift: false,
			ctrl: false,
			alt: false,
			lshift: false,
			lctrl: false,
			lalt: false,
			rshift: false,
			rctrl: false,
			ralt: false
		}
	}
}


function saveLevel( ) {
	var save = {
		version: 2,
		kinds: { },
		spawns: { }
	};

	for (var kindName in kinds) {
		var kind = kinds[kindName], cells = packageCells(kind.cells);

		if (cells === "") continue; // don't save an empty kind

		save.kinds[kindName] = { };

		for (var k in kind) {
			if (k === "cells") continue;
			// if (kind[k] === kindDefaults[k]) continue;

			save.kinds[kindName][k] = kind[k];
		}
		save.kinds[kindName].cells = cells;
	}

	for (var s in spawns) {
		var spawn = spawns[s];

		if (!save.kinds[spawn.kindName]) continue; // if the kind was omitted, its spawns must be omitted

		save.spawns[s] = { };

		for (var k in spawn) {
			if (k === "state") continue;

			save.spawns[s][k] = spawn[k];
		}
	}

	return save;

	function packageCells(cells) {
		var packed = [ ];
		for (var c in cells) {
			packed.push(cells[c].x + " " + cells[c].y + " " + cells[c].color);
		}
		return packed.join(":");
	}
}

function loadLevel(save) {
	kinds = { };
	spawns = { };

	for (var kindName in save.kinds) {
		kinds[kindName] = save.kinds[kindName];
		kinds[kindName].cells = unpackCells(kinds[kindName].cells);

		// add defaults to each kind
		//for (var k in kindDefaults) {
		//	if (!kinds[kindName].hasOwnProperty(k)) kinds[kindName][k] = kindDefaults[k];
		//}
	}

	for (var spawnName in save.spawns) {
		spawns[spawnName] = save.spawns[spawnName];
	}

	obs = [ ];

	for (var s in sectors) {
		sectors[s].spawns = { };
	}

	partitionSpawnsIntoSectors(spawns);

	function unpackCells(pack) {
		var cells = { }, unpacked = pack.split(":");
		for (var i = 0; i < unpacked.length; i++) {
			var parts = unpacked[i].split(" "),
				x = +parts[0], y = +parts[1], color = +parts[2];
			cells[x + "," + y] = {
				x: x, y: y, color: color
			};
		}
		return cells;
	}
}


function mergeKinds(baseKinds, savedKinds) {
	updateKinds(baseKinds);
	return baseKinds;
}

function updateKinds(kinds) {
	// bootstrap old versions of the data format as needed so nothing breaks on refresh
	if (kinds.version === 0) {
		// convert string-based sprites to cell-based directives
		for (var kindName in kinds) {
			var kind = kinds[kindName];
			if (kind.sprite) {
				addDirectivesToStringBasedKind(kind);
			}
		}

		kinds.version = 1;
	}

	if (kinds.version === 1) {
		for (var kindName in kinds) {
			var kind = kinds[kindName];
			if (kind.directives) {
				addCellsToDirectivesBasedKind(kind);
			}

			kind.kindName = kindName;
		}

		kinds.version = 2;
	}

	function addDirectivesToStringBasedKind(kind) {
		var
			str = kind.sprite,
			directives = [],
			width = 0, height = 0
			x = 0, y = 0;

		kind.directives = [ ];
		// this is ok because the anchor will be at 0, 0 in this version
		kind.x1 = 0;
		kind.y1 = 0;
		kind.x2 = 0;
		kind.y2 = 0;

		for (var i=0; i < str.length; i++) {
			var ch = str.charCodeAt(i);

			if (ch == 10) {x = 0; y++; continue;}

			if (ch > 32) {
				addDirective(kind, x, y, "draw blue");
				addDirective(kind, x, y, "body stop");
			}

			addDirective(kind, 0, 0, "anchor at"); // there were no anchors yet in version 0

			x ++;
		}

		// update bounds (in version 0, all @s are at 0 0)


		delete kind.sprite;

		function newDirective() {
			return {
				x: [], y: [], param: []
			};
		}
	}

	function addCellsToDirectivesBasedKind(kind) {
		var directives = kind.directives;
		kind.cells = { }; // indexed by "x,y", content is args[3] of a body directive: stop, stab
		kind.anchors = { }; // indexed by the anchor type, used for yoking and flipping
		
		for (var i=0; i<directives.length; i++) {
			var args = directives[i].split(" "),
				x = +args[0],
				y = +args[1];

			// register tags:		
			if (args[2] === "draw") {
				drawOnKind(kind, x, y, 0);
			}

			if (args[2] === "anchor") {
				kind.anchors[args[3]] = {
					x: x,
					y: y
				}
			}
		}

		delete kind.directives;
	}
}

function mergeSpawns(baseSpawns, savedSpawns) {
	for (var k in baseSpawns) {
		baseSpawns[k].spawnName = k;
	}

	return baseSpawns;
}

function touchSpawnsInCellRect(spawns, frameStamp, x1, y1, x2, y2) {
	// two uses:
	// 1. activate objects when the camera touches them
	// 2. activate off-screen objects when an active object touches them (lastSeen is an issue though)

	forSectorsInCellRect(x1, y1, x2, y2, function(sector) {
		for (var spawnName in sector.spawns) {
			touchSpawn(sector.spawns[spawnName]);
		}
	});
}

function touchSpawn(spawn) {
	if (!spawn.state.ob) {
		var ob = spawnGuy(spawn.spawnName, spawn, frameStamp);
		spawn.state.ob = ob;
		obs.push(ob);
	}
}

function forActiveObjects(frameStamp, despawn, cb) {
	var
		x1 = camera.x,
		y1 = camera.y,
		x2 = camera.x + camera.width,
		y2 = camera.y + camera.height;

	for (var i = 0; i < obs.length; i++) {
		var ob = obs[i];
		if (!(x1 < ob.x + ob.kind.x2 && y1 < ob.y + ob.kind.y2 && x2 > ob.x + ob.kind.x1 && y2 > ob.y + ob.kind.y1)) {
			if (frameStamp - ob.lastSeen > 30 * 20) {
				// they survive twenty game seconds off screen
				if (despawn) {
					obs.splice(i, 1);
					ob.spawn.state.ob = null;
					i--;
				}
				continue;
			} else {
				// it's off screen, but still alive
				cb(ob);
			}
		} else {
			ob.lastSeen = frameStamp;
			cb(ob);
		}
	}
}

function unregisterObject(ob) {
	var
		x1 = ob.x + ob.kind.x1,
		y1 = ob.y + ob.kind.y1,
		x2 = ob.x + ob.kind.x2,
		y2 = ob.kind.y2;

	forSectorsInCellRect(x1, y1, x2, y2, function(sector) {
		delete sector.obs[ob.name];
	});
}

function registerObject(ob) {
	var
		x1 = ob.x + ob.kind.x1,
		y1 = ob.y + ob.kind.y1,
		x2 = ob.x + ob.kind.x2,
		y2 = ob.kind.y2;

	forSectorsInCellRect(x1, y1, x2, y2, function(sector) {
		sector.obs[ob.name] = ob;
	});
}

function partitionSpawnsIntoSectors(spawns) {
	for (var spawnName in spawns) {
		var spawn = spawns[spawnName],
			kind = kinds[spawn.kindName];

		if (spawnName === "version") continue;
		
		// spawn.state is refreshed whenever spawns are reset and deleted when they are saved
		spawn.state = {
			ob: null
		};

		forSectorsInCellRect(spawn.x + kind.x1, spawn.y + kind.y1, spawn.x + kind.x2, spawn.y + kind.y2, function(sector) {
			sector.spawns[spawnName] = spawn;
		});
	}
}

function forSectorsInCellRect(x1, y1, x2, y2, cb) {
	var
		x1 = Math.floor(x1 / sectorSize),
		x2 = Math.floor(x2 / sectorSize),
		y1 = Math.floor(y1 / sectorSize),
		y2 = Math.floor(y2 / sectorSize);

		for (var x = x1; x <= x2; x++) {
			for (var y = y1; y <= y2; y++) {
				cb(getSector(sectors, x, y));
			}
		}
}


function forObjectsInCellRect(x1, y1, x2, y2, cb) {
	for (var i = 0; i < obs.length; i++) {
		var ob = obs[i];
		if (!(ob.x + ob.kind.x2 < x1 || ob.y + ob.kind.y2 < y1 || ob.x + ob.kind.x1 > x2 || ob.y + ob.kind.y1 > y2)) {
			cb(ob);
		}
	}
}

function getSector(sectors, x, y) {
	var
		index = x + "," + y,
		sector = sectors[index];

	if (sector) return sector;
	return sectors[index] = newSector();

	function newSector() {
		return {
			// 1. all of these are indexed by spawn-id (we'll handle timed multispawn later)
			// 2. a single spawn appears in ALL sectors its bounding rectangle overlaps
			// 3. because spawns and obs overlap sectors, these must be indexed this way, and
			//    not be arrays, for speedy lookup to avoid double spawns
			// 4. if a spawn or object appears in more than one sector, the object
			//    is referentially identical
			spawns: { },
			activeSpawns: { }
		}
	}
}

function getScripts(type) {
	var
		all = document.getElementsByTagName("script"),
		ok = [], i;

	for (i = 0; i < all.length; i++) 
		if (all[i].type.toLowerCase() == type)
			ok.push(all[i].textContent)

	console.log(ok);

	return ok;
}
