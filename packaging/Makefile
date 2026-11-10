# ============================================================================
# luci-app-singbox —— OpenWrt 包 Makefile
#
# 用法（在 OpenWrt SDK 中）：
#   cp -r luci-app-singbox package/
#   make package/luci-app-singbox/compile V=s
#
# 产物：bin/packages/<arch>/base/luci-app-singbox_<ver>_all.ipk
# ============================================================================

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-singbox
PKG_VERSION:=1.0.2
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=luci-app-singbox contributors

LUCI_TITLE:=LuCI support for sing-box
LUCI_DESCRIPTION:=Web UI for sing-box — nodes, routing rules, logs, \
	with rule-set editing and zashboard integration.
LUCI_DEPENDS:=+ucode +ucode-mod-fs +ucode-mod-uci +rpcd +sing-box
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

# 可选：Zashboard 集成依赖
define Package/luci-app-singbox/conffiles
/etc/config/singbox-ui
endef

$(eval $(call BuildPackage,luci-app-singbox))
