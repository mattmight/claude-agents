PREFIX := $(HOME)/bin

.PHONY: install uninstall build

build:
	npm run build

install: build
	@mkdir -p $(PREFIX)
	ln -sf "$(CURDIR)/bin/claude-agents" $(PREFIX)/claude-agents
	@echo "Symlinked $(PREFIX)/claude-agents → $(CURDIR)/bin/claude-agents"

uninstall:
	rm -f $(PREFIX)/claude-agents
	@echo "Removed $(PREFIX)/claude-agents"
